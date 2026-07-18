# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

## Dispatch label

`ready-for-agent` is a triage **classification** — it records that an issue is fully
specified and safe for autonomous work, but it triggers nothing on its own. Actually
routing an issue into the Sandcastle AFK pipeline is a separate, deliberate act:

| Label in our tracker | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `sandcastle`         | Dispatch: hand this issue to the Sandcastle pipeline |

Sandcastle's planner selects on `sandcastle` only (see `.sandcastle/plan-prompt.md`). Keep
triage (`ready-for-agent`) and dispatch (`sandcastle`) as two signals so marking an issue
agent-ready doesn't commit compute until someone applies `sandcastle`.

Two **category** roles run alongside the state roles; every triaged issue carries one of each:

| Category role | Label in our tracker | Meaning                    |
| ------------- | -------------------- | -------------------------- |
| `bug`         | `bug`                | Something is broken        |
| `enhancement` | `enhancement`        | New feature or improvement |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

All labels above exist in the GitHub repo. Edit the right-hand column if you rename any.
