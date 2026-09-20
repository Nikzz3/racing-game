# Research: `mattpocock/course-video-manager` — Sandcastle wiring

Primary-source review of Matt Pocock's public repo, read against its own code, config, and
docs via the GitHub API. Matt Pocock is the **creator of Sandcastle** (`@ai-hero/sandcastle`),
so his use of it here is the canonical reference implementation. Every non-trivial claim links
to the file at a pinned commit so citations stay stable.

- **Repo:** https://github.com/mattpocock/course-video-manager
- **Pinned commit (all links below):** `80a8f30cb3e665bd3826170d4335229e81d3563e`
- **Default branch:** `main` · **Primary language:** TypeScript · repo `description` is **null**
- No public stock/scaffold Sandcastle repo to diff against: `ai-hero-dev/sandcastle` contents
  return 404 (private or renamed); `@ai-hero/sandcastle` `^0.10.0` ships only as an npm lib
  ([package.json](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/package.json)).
  So the "stock vs his" diff below is against **his own two variants** (see §6).

> **Headline for our decision:** this repo contains **two** Sandcastle setups. (A) a
> **planner-loop template** in `.sandcastle/main.ts` — the same shape as our
> `racing-game/.sandcastle/main.ts` — whose issue selection uses **no trigger label at all**;
> and (B) the **production AFK platform**: 8 GitHub Actions workflows where the execution
> trigger is the **`agent:implement`** label, and the human "this is ready" triage label is
> **`Sandcastle`** (his repo's spelling of `ready-for-agent`). **He separates the two jobs**:
> `Sandcastle`/`ready-for-agent` = triage classification (triggers nothing); `agent:implement`
> = the dispatch action that fires a run. See §2 and §5.

---

## 1. Repo purpose & stack (brief)

**Purpose**, in his own words:

> "A tool for managing course video publishing workflows — editing metadata, generating
> descriptions, creating thumbnails, and posting to social platforms."
> — [`README.md`](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/README.md)

His internal tool for the AI Hero / Total TypeScript course pipeline (Dropbox → Zapier →
Buffer social posting is documented in the README).

**Stack** (from
[package.json](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/package.json)):
React Router 7 + React 19, **Effect** (services + `@effect/cli`), **Drizzle ORM**/Postgres
(generated SQL migrations), Vercel AI SDK v6, Radix/shadcn/Tailwind 4, tldraw, Vitest +
evalite + dependency-cruiser. Feature-sliced `app/features/*`, deep-module `app/packages/*`
(boundary-enforced). 21 ADRs under `docs/adr/`; **`docs/research/` already exists** with three
notes — the same convention this file follows.

## 2. Trigger label — the exact source

There are two dispatch mechanisms in the repo, with different (or no) trigger labels.

### (A) Planner-loop template — `.sandcastle/main.ts` → `plan-prompt.md`: NO label filter

`pnpm sandcastle` runs
[`.sandcastle/main.ts`](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/main.ts),
a Ralph-style loop (Plan → Execute+Review in parallel Docker sandboxes → Merge). The planner's
issue selection is delegated to
[`.sandcastle/plan-prompt.md`](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/plan-prompt.md),
whose exact command is:

```sh
gh issue list --state open --json number,title,body,labels,comments \
  --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'
```

**There is no `--label` filter.** His template planner considers **every open issue** and
reasons about dependency ordering itself; the only exclusion in-prompt is "a PRD that has
implementation issues linking to it cannot be worked on"
([plan-prompt.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/plan-prompt.md)).

> **Contrast — our repo added a gate.** Our
> `racing-game/.sandcastle/plan-prompt.md` line 7 uses
> `gh issue list --state open --label ready-for-agent --limit 100 --json …`. The
> `--label ready-for-agent` filter is **our divergence** from his template, not something he
> ships. (Verified locally at `/var/home/nick/Code/racing-game/.sandcastle/plan-prompt.md`.)

### (B) Production AFK platform — trigger label is `agent:implement`

The real, event-driven pipeline is 8 GitHub Actions workflows
([`.github/workflows/agent-*.yml`](https://github.com/mattpocock/course-video-manager/tree/80a8f30cb3e665bd3826170d4335229e81d3563e/.github/workflows),
all confirmed `active`). The implement workflow keys off a **label event**, not an issue
list:

```yaml
# .github/workflows/agent-implement.yml
on:
  issues:
    types: [labeled]
jobs:
  implement:
    if: github.event.label.name == 'agent:implement'
```

([agent-implement.yml](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.github/workflows/agent-implement.yml))

So in the production path there is **no `gh issue list` polling** — a label _event_ fires a
single-issue run. The eight triggers:

| Workflow file              | Trigger label / event                    | Purpose                                        |
| -------------------------- | ---------------------------------------- | ---------------------------------------------- |
| `agent-to-issues-prd.yml`  | issue `agent:to-issues`                  | Decompose PRD → flat native sub-issues         |
| `agent-implement.yml`      | issue `agent:implement` (no sub-issues)  | Implement one issue → draft PR                 |
| `agent-implement-prd.yml`  | issue `agent:implement` (has sub-issues) | Implement next sub-issue, chain until PRD done |
| `agent-review.yml`         | PR `agent:review`                        | Review **and improve** the PR                  |
| `agent-implement-pr.yml`   | PR `agent:implement`                     | Address unresolved review feedback             |
| `agent-update-branch.yml`  | PR `agent:update-branch`                 | Merge base in (agent only if conflicts)        |
| `agent-promote-queued.yml` | issue **closed**                         | Promote `agent:queued` whose blockers cleared  |
| `architecture-review.yml`  | daily `schedule`                         | Propose one improvement PRD per weekday        |

(Triggers from the spec table and confirmed against `agent-implement.yml`;
[afk-agent-platform-spec.md §1](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md).)

## 3. Label lifecycle & idempotency

### Planner-loop template (variant A)

- **No label add/remove anywhere.** `main.ts` never touches labels
  ([main.ts](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/main.ts)).
- The implement stage is told **"Do not close the issue - this will be done later"**
  ([implement-prompt.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/implement-prompt.md)).
  Closing happens in the **Merge** stage: after merging each branch the merger runs
  `gh issue close`, cascading to any parent PRD
  ([merge-prompt.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/merge-prompt.md)).
- **Idempotency is state + branch-name based, not label based:** issues are re-selected each
  iteration by `gh issue list --state open`; once merged+closed they drop out of the list.
  Branch names are **deterministic** (`sandcastle/issue-{number}-{slug}`), so re-planning the
  same issue reuses the same branch and accumulates progress rather than duplicating it
  ([plan-prompt.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/plan-prompt.md)).
  There is **no label to prevent re-processing** — an unclosed issue _will_ be picked again.

### Production platform (variant B) — a full label state machine

Labels **are** the state; there is no external DB. Documented transitions
([spec §3.2](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md),
seen live in `agent-implement.yml`):

1. **On accept:** remove the trigger label, remove `agent:blocked`, add `agent:in-progress`.
2. **On success:** remove `agent:in-progress`, add the next chain label (e.g. `agent:review`).
3. **On failure:** add `agent:blocked` + diagnostic comment; **always** remove `in-progress`.
4. **On refusal (preflight):** remove trigger, add `agent:blocked`, comment why.

**`agent:in-progress` doubles as a lock**, and idempotency is enforced by preflights: the
implement workflow computes issue _shape_ (sub-issues via REST `…/sub_issues`, parent via
GraphQL) to route PRD vs standalone vs "refuse — label the parent," and refuses if an open PR
already targets the issue
([agent-implement.yml](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.github/workflows/agent-implement.yml)).
`agent:queued` auto-promotes to `agent:implement` when the last **native GitHub blocker**
closes — never parsed from "Blocked by #N" prose
([queued-promotion.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/queued-promotion.md)).

## 4. `.sandcastle/` layout, models, branches, integration

Two coexisting layers under
[`.sandcastle/`](https://github.com/mattpocock/course-video-manager/tree/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle):

**Variant A (planner loop):** `main.ts` + four prompt files — `plan-prompt.md`,
`implement-prompt.md`, `review-prompt.md`, `merge-prompt.md`. Phases: **Plan** (1 agent) →
**Execute+Review** (per issue: implement in a fresh Docker sandbox, then review _only if the
implement produced commits_, up to `MAX_PARALLEL = 4`, `MAX_ITERATIONS = 10`) → **Merge** (1
agent). Model: **`claude-opus-4-6` for every stage**. Plan output parsed from `<plan>` tags by
**regex** (`plan.stdout.match(/<plan>…<\/plan>/)`), not a schema. Implement commits use a
**`RALPH:` prefix**
([main.ts](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/main.ts),
[implement-prompt.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/implement-prompt.md)).

**Branch naming:** `sandcastle/issue-{number}-{slug}` (planner) / `agent/issue-<n>-<slug>` and
`agent/prd-<n>-<slug>` (platform,
[spec §3.9](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md)).

**Integration strategy — differs by variant:**

- **Planner template:** the Merger merges completed branches into the **current branch** and
  **closes the issues itself**; the Merger runs in a default-branch sandbox (no `branch:` set),
  i.e. it effectively lands work on **main** and self-closes
  ([main.ts](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/main.ts),
  [merge-prompt.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/merge-prompt.md)).
- **Production platform:** a **hard invariant that nothing auto-merges** — Review posts
  `event: "COMMENT"` (never `APPROVE`); a human is the sole merge gate
  ([spec §3.9, §4.4](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md)).

**Variant B (platform):** per-workflow TS runners `.sandcastle/<workflow>/<workflow>.ts` +
`prompt.md` (work) + `extraction.md` (structured-emit), `run-with-retry.ts` (single-pass) and
`run-with-extraction.ts` (two-pass produce-then-extract, so a malformed JSON emit can't discard
side effects), `parse-diff-lines.ts` (drops hallucinated inline anchors). Reference stack:
`@ai-hero/sandcastle` driving `claudeCode("claude-opus-4-6")` in a `noSandbox()` sandbox,
`OUTPUT_DIR = runner.temp`
([spec §3.8, Appendix A](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md)).
**Core seam:** the runner _only emits files_; the orchestrator (Actions) owns **all** label /
comment / push / PR / close mutations — the agent never holds a GitHub token, which is what
makes the runner swappable and unit-testable
([spec §0, §3.8](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md)).

## 5. Two-label separation — his actual answer (the decision we're facing)

**Yes — he uses two distinct signals doing two distinct jobs**, most clearly in the production
platform:

- **Triage "ready" classification:** the label `Sandcastle` — his repo's spelling of the
  canonical `ready-for-agent` role. Mapping is explicit:
  `ready-for-agent → Sandcastle`, described "Issues for Sandcastle to work on"
  ([triage-labels.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/triage-labels.md),
  [CLAUDE.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/CLAUDE.md)).
  His live label set (labels API) even carries **both** `Sandcastle` and a separate
  `ready-for-agent` ("PRD ready for an implementing agent to pick up") — the same coexistence
  our repo has.
- **Dispatch action:** the `agent:*` execution labels — `agent:implement` is the one that
  _fires_ a run; `agent:to-issues`, `agent:review`, `agent:queued`, `agent:in-progress`,
  `agent:blocked`, `agent:update-branch` carry the rest of the state machine
  ([triage-labels.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/triage-labels.md)).

The triage label **triggers nothing** on its own. A human (or the Promote-Queued workflow)
applies `agent:implement` to dispatch. In other words: _classification and dispatch are
decoupled_ — a human marks an issue ready (`Sandcastle`/`ready-for-agent`), and a separate,
deliberate act (`agent:implement`) starts the agent. `agent:queued` is the buffer between them:
human-applied, auto-promoted to `agent:implement` only when native blockers clear
([queued-promotion.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/queued-promotion.md)).

**Note the wrinkle:** his _planner-loop template_ (variant A) collapses this — no label at all,
every open issue is fair game. The two-label separation is a property of the **mature platform**,
not the template. Our repo currently sits in between: we run the template but bolted a single
`ready-for-agent` gate onto the planner's `gh issue list`.

## 6. Divergences (his design intent vs. our current setup)

Since he owns the tool, differences are signal. Comparing his repo to ours
(`/var/home/nick/Code/racing-game/.sandcastle/`, `docs/agents/`, live `gh label list`):

| Dimension              | His planner template                       | His production platform                                         | Our racing-game                                               |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Dispatch               | `pnpm sandcastle` batch loop               | `issues:[labeled]` events                                       | batch loop (`main.ts`)                                        |
| Trigger label          | **none** (all open issues)                 | `agent:implement`                                               | **`ready-for-agent`** filter on `gh issue list`               |
| Ready/triage label     | —                                          | `Sandcastle` (=`ready-for-agent`)                               | `ready-for-agent` **and** `Sandcastle` both exist             |
| `agent:*` state labels | none                                       | full set (`in-progress` lock, `blocked`, `review`, `queued`, …) | **none**                                                      |
| Model per stage        | opus-4-6 everywhere                        | opus-4-6                                                        | opus-4-8 (plan/review/merge), **sonnet-4-6** (implement)      |
| Plan parsing           | `<plan>` regex                             | schema-validated JSON                                           | `Output.object` + Zod schema                                  |
| Sandbox                | Docker                                     | `noSandbox()` (CI)                                              | **podman**                                                    |
| Integration            | merge to **current/main**, self-close      | **nothing auto-merges** (human gate)                            | **`integration/sandcastle` branch**, "do NOT merge to master" |
| Idempotency            | deterministic branch name + close-on-merge | `agent:in-progress` lock + PR preflight                         | `ready-for-agent` gate + close-on-merge                       |

(Our-side facts from `/var/home/nick/Code/racing-game/.sandcastle/main.ts`, `plan-prompt.md`,
`merge-prompt.md`, and `gh label list`.)

Two of our choices already **anticipate his production platform** even though we run his
template: our human-gated `integration/sandcastle` branch mirrors his platform's "nothing
auto-merges" invariant, and our `ready-for-agent` planner filter is a crude stand-in for his
`Sandcastle`/`agent:implement` split.

## 7. What's transferable — priority order

1. **Split classification from dispatch, as he does.** Keep `ready-for-agent` (or `Sandcastle`)
   as the human triage "ready" mark, and add a distinct **`agent:implement`** as the act that
   actually launches a run. Today our single `ready-for-agent` does both jobs; his source shows
   the mature answer is two labels
   ([triage-labels.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/triage-labels.md)).
2. **Add the `agent:*` state labels — especially `agent:in-progress` as a lock and
   `agent:blocked` with a diagnostic comment.** Our planner has no run-state visibility and no
   dedup beyond issue-open state; his lock + PR-preflight is the idempotency model to copy
   ([spec §3.2](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md)).
3. **Consider migrating from batch-poll to `issues:[labeled]` events** (his production
   topology). Mind the `AGENT_PAT` rule: `GITHUB_TOKEN`-set labels don't fire downstream
   workflows, so any chained label needs a PAT with graceful fallback
   ([spec §3.4](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md)).
4. **`agent:queued` + native-dependency auto-promotion.** Externalise our in-planner dependency
   graph to GitHub's native blocker relation; auto-promote on close. Human-inspectable, survives
   across runs
   ([queued-promotion.md](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/queued-promotion.md)).
5. **`runWithExtraction` (produce-then-extract).** For our merge/review stages: never make one
   LLM turn both do side-effecting work and emit rigid JSON — split them so a bad emit can't
   discard commits
   ([run-with-extraction.ts](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.sandcastle/run-with-extraction.ts)).
6. **The spec doc itself** —
   [`afk-agent-platform-spec.md`](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md)
   is written to be re-implementable in a fresh repo. Our `docs/agents/{triage-labels,domain}.md`
   are already trimmed descendants of his, so alignment is low-friction.
7. **PRD → native sub-issues** ([`to-issues-project` skill](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/.claude/skills/to-issues-project/SKILL.md))
   and **scheduled Architecture Review** proposing one PRD/weekday
   ([spec §4.8](https://github.com/mattpocock/course-video-manager/blob/80a8f30cb3e665bd3826170d4335229e81d3563e/docs/agents/afk-agent-platform-spec.md))
   are self-feeding-backlog patterns we lack.

**Watch-out:** his production platform's "human is the only merge gate" contradicts our
planner's auto-merge-to-integration step — but our integration branch already softens that.
Decide deliberately if we adopt the event-driven model.
