# Coding Standards

<!-- Customize this file with your project's coding standards.
     The reviewer agent loads it during code review via @.sandcastle/CODING_STANDARDS.md
     so these standards are enforced during review without costing tokens during implementation. -->

## Style

<!-- Example:
- Use camelCase for variables and functions
- Use PascalCase for classes and types
- Prefer named exports over default exports
-->

## Testing

- Follow `docs/agents/e2e-testing.md` for the outside-in workflow and suite conventions.
- Use `.spec.ts` for Playwright e2e tests and `.test.ts` for Vitest unit tests.
- Extend an existing e2e journey unless the feature introduces a genuinely new flow.
- Keep e2e coverage focused on integration; logic reachable by a unit test belongs in
  Vitest.

## Architecture

<!-- Example:
- Keep modules focused on a single responsibility
- Prefer composition over inheritance
-->
