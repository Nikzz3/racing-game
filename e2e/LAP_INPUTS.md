# Recorded lap inputs

`lap-inputs.json` is the committed `CarInput[]` used by the lap-driving fixture.
It is generated from the same `runAutopilotLap` harness that exercises the game
physics, with Sunset Ridge Circuit and medium Difficulty defaults.

Regenerate it after an intentional physics, Track, or autopilot change:

```sh
npx tsx e2e/scripts/generate-lap-inputs.ts
```

Run `npm run test:e2e -- specs/drive-lap.spec.ts` afterward to prove that the
new recording remains a server-accepted Plausible Lap.
