# Sunset Ridge Racing

A browser-based 3D multiplayer racing game (Three.js client, Node.js WebSocket server,
Postgres leaderboard). See `README.md` for how to run it and `CONTEXT.md` for the domain
glossary.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues (`Nikzz3/racing-game`), via the `gh` CLI. External
PRs are **not** a triage surface. Issues labelled `sandcastle` are picked up by the
Sandcastle AFK pipeline (`.sandcastle/`) — the dispatch trigger, distinct from the
`ready-for-agent` triage state. See `docs/agents/issue-tracker.md`.

### Triage labels

Five state roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`) plus two category roles (`bug`, `enhancement`); label strings equal role names.
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
