// Sandcastle orchestration loop: plan -> implement + review (per issue, in
// parallel) -> merge into the integration branch. Repeats up to MAX_ITERATIONS
// so issues unblocked by a round of merges are picked up next round. Master is
// never touched; promoting integration to master is a human-driven step.
//
// Usage: npm run sandcastle

import * as sandcastle from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { execSync } from "node:child_process";
import { z } from "zod";

const planSchema = z.object({
  issues: z.array(z.object({ id: z.string(), title: z.string(), branch: z.string() })),
});

const MAX_ITERATIONS = 10;
const PLANNER_AGENT = sandcastle.claudeCode("claude-opus-4-8");
const IMPLEMENTER_AGENT = sandcastle.claudeCode("claude-fable-5");
const REVIEWER_AGENT = sandcastle.claudeCode("claude-fable-5");
const MERGER_AGENT = sandcastle.claudeCode("claude-opus-4-8");
const INTEGRATION_BRANCH = "integration/sandcastle";

// Share the host Codex login with every ephemeral container. Run `codex login`
// on the host to create/refresh this subscription credential.
const SANDBOX = podman({
  mounts: [
    { hostPath: "~/.codex/auth.json", sandboxPath: "/home/agent/.codex/auth.json", readonly: true },
  ],
});

// node_modules is copied from the host so the sandbox skips a full install; the
// hook then picks up platform-specific binaries and packages added since the copy.
const hooks = { sandbox: { onSandboxReady: [{ command: "npm install" }] } };
const copyToWorktree = ["node_modules"];

// Ensure the integration branch exists and is up to date with master before the
// loop starts; issue branches fork from it, so without this sync the run drifts
// behind master and the promotion PR ends in conflicts. Conflicts between master
// and integration abort the run: resolve them by hand rather than letting agents
// build on a half-merged base.
execSync("git fetch origin master", { stdio: "inherit" });
execSync(
  `git rev-parse --verify --quiet ${INTEGRATION_BRANCH} || git branch ${INTEGRATION_BRANCH} origin/master`,
  { stdio: "inherit" },
);
if (execSync("git branch --show-current").toString().trim() === INTEGRATION_BRANCH) {
  execSync("git merge --no-edit origin/master", { stdio: "inherit" });
} else {
  try {
    // Fast-forward the ref without touching this working tree.
    execSync(`git fetch . origin/master:${INTEGRATION_BRANCH}`, { stdio: "inherit" });
  } catch {
    // Branches diverged: merge in a throwaway worktree.
    const syncWorktree = ".sandcastle/worktrees/integration-sync";
    execSync(`git worktree add ${syncWorktree} ${INTEGRATION_BRANCH}`, { stdio: "inherit" });
    try {
      execSync("git merge --no-edit origin/master", { cwd: syncWorktree, stdio: "inherit" });
    } finally {
      execSync(`git worktree remove --force ${syncWorktree}`, { stdio: "inherit" });
    }
  }
}

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // The planner reads the open issues and picks the ones with no blocking
  // dependencies, emitted as a <plan> JSON block. Structured output requires
  // maxIterations: 1; a missing or invalid plan throws and aborts the loop.
  const plan = await sandcastle.run({
    hooks,
    sandbox: SANDBOX,
    name: "planner",
    maxIterations: 1,
    agent: PLANNER_AGENT,
    promptFile: "./.sandcastle/plan-prompt.md",
    output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
  });

  const issues = plan.output.issues;
  if (issues.length === 0) {
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(`Planning complete. ${issues.length} issue(s) to work in parallel:`);
  for (const issue of issues) console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);

  // Implementer and reviewer share one sandbox per issue; the reviewer only runs
  // if the implementer committed. allSettled keeps one failure from cancelling the rest.
  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        baseBranch: INTEGRATION_BRANCH,
        sandbox: SANDBOX,
        hooks,
        copyToWorktree,
      });
      try {
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: IMPLEMENTER_AGENT,
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: { TASK_ID: issue.id, ISSUE_TITLE: issue.title, BRANCH: issue.branch },
        });
        if (implement.commits.length === 0) return implement;

        const review = await sandbox.run({
          name: "reviewer",
          maxIterations: 1,
          agent: REVIEWER_AGENT,
          promptFile: "./.sandcastle/review-prompt.md",
          promptArgs: { BRANCH: issue.branch },
        });
        // Each run only reports its own commits; the merge phase needs both.
        return { ...review, commits: [...implement.commits, ...review.commits] };
      } finally {
        await sandbox.close();
      }
    }),
  );

  const completedIssues = issues.filter((issue, i) => {
    const outcome = settled[i]!;
    if (outcome.status === "rejected") {
      console.error(`  ✗ ${issue.id} (${issue.branch}) failed: ${outcome.reason}`);
      return false;
    }
    return outcome.value.commits.length > 0;
  });
  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(`\nExecution complete. ${completedBranches.length} branch(es) with commits:`);
  for (const branch of completedBranches) console.log(`  ${branch}`);
  if (completedBranches.length === 0) {
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  await sandcastle.run({
    hooks,
    sandbox: SANDBOX,
    name: "merger",
    maxIterations: 1,
    agent: MERGER_AGENT,
    promptFile: "./.sandcastle/merge-prompt.md",
    // Merge commits land on the integration branch, not the host's current branch.
    branchStrategy: { type: "branch", branch: INTEGRATION_BRANCH },
    promptArgs: {
      INTEGRATION_BRANCH,
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  console.log(`\nBranches merged into ${INTEGRATION_BRANCH}.`);
}

console.log("\nAll done.");
