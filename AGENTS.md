# Sunset Ridge Racing

A browser-based 3D multiplayer racing game (Three.js client, Node.js WebSocket server,
Postgres leaderboard). See `CONTRIBUTING.md` for how to run it and `CONTEXT.md` for the domain
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

### End-to-end testing

Playwright is the outside-in bookend and Vitest is the feature-development inner loop.
See `docs/agents/e2e-testing.md` for suite conventions, commands, and growth rules.

### Worktrees

T3 Code threads run in git worktrees; `t3.json` installs dependencies and starts the shared
Postgres on creation. Ports 8080/5173 are shared with the main checkout — use
`PORT=8090 CLIENT_PORT=5183 npm run dev` when another checkout is already serving. See
"Working in git worktrees" in `CONTRIBUTING.md`.
