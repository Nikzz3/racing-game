# TASK

You are on the `{{INTEGRATION_BRANCH}}` branch. Merge the following branches into it. Do NOT merge anything into master — promoting `{{INTEGRATION_BRANCH}}` to master is a separate, human-driven step.

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`gh issue close <ID> --comment "Completed by Sandcastle (merged to {{INTEGRATION_BRANCH}}, pending promotion to master)"`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
