/**
 * Outputs the Stormhaven Circuit centerline samples as a JSON array.
 * Used by rl/tests/test_golden.py to verify TS↔Python parity for the new Track.
 *
 * Usage: npx tsx rl/gen_stormhaven_samples.ts
 */
import { STORMHAVEN } from '../shared/src/track.ts';

process.stdout.write(JSON.stringify(STORMHAVEN.samples));
