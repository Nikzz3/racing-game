import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runPolicyLap, type PolicyWeights } from './harness';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_PATH = join(__dirname, '../../../rl/training_progress.json');
const POLICY_PATH = join(__dirname, '../../../rl/policy.json');

interface RewardCheckpoint {
  timesteps: number;
  mean_episode_reward: number;
}

interface EvalLap {
  timesteps: number;
  mean_lap_time_s: number | null;
  n_laps: number;
}

interface PlateauAnalysis {
  detected: boolean;
  detected_at_timesteps: number;
  window_size: number;
  threshold_pct: number;
  verdict: string;
}

interface ValidatedRecord {
  lap_time_s: number;
  autopilot_baseline_s: number;
  speedup_pct: number;
  validation: string;
}

interface TrainingProgress {
  training_run: { algorithm: string; total_timesteps: number; n_envs: number };
  reward_log: RewardCheckpoint[];
  eval_laps: EvalLap[];
  plateau_analysis: PlateauAnalysis;
  validated_record: ValidatedRecord;
}

const progressExists = existsSync(PROGRESS_PATH);

describe('training_progress.json — plateau record', () => {
  it('exists at rl/training_progress.json', () => {
    expect(progressExists).toBe(true);
  });

  it.skipIf(!progressExists)('has all required top-level keys', () => {
    const data = JSON.parse(readFileSync(PROGRESS_PATH, 'utf-8')) as TrainingProgress;
    expect(data).toHaveProperty('training_run');
    expect(data).toHaveProperty('reward_log');
    expect(data).toHaveProperty('eval_laps');
    expect(data).toHaveProperty('plateau_analysis');
    expect(data).toHaveProperty('validated_record');
  });

  it.skipIf(!progressExists)('reward_log has ordered checkpoints with overall improvement', () => {
    const { reward_log } = JSON.parse(readFileSync(PROGRESS_PATH, 'utf-8')) as TrainingProgress;
    expect(reward_log.length).toBeGreaterThan(5);
    for (let i = 1; i < reward_log.length; i++) {
      expect(reward_log[i].timesteps).toBeGreaterThan(reward_log[i - 1].timesteps);
    }
    const first = reward_log[0].mean_episode_reward;
    const last = reward_log[reward_log.length - 1].mean_episode_reward;
    expect(first).toBeLessThan(last);
  });

  it.skipIf(!progressExists)('plateau_analysis confirms plateau was detected', () => {
    const { plateau_analysis } = JSON.parse(
      readFileSync(PROGRESS_PATH, 'utf-8')
    ) as TrainingProgress;
    expect(plateau_analysis.detected).toBe(true);
    expect(plateau_analysis.detected_at_timesteps).toBeGreaterThan(0);
    expect(typeof plateau_analysis.verdict).toBe('string');
    expect(plateau_analysis.verdict.length).toBeGreaterThan(0);
  });

  it.skipIf(!progressExists)('eval_laps show improving Python-env lap times across training', () => {
    const { eval_laps } = JSON.parse(readFileSync(PROGRESS_PATH, 'utf-8')) as TrainingProgress;
    const completed = eval_laps.filter(e => e.mean_lap_time_s !== null);
    expect(completed.length).toBeGreaterThan(0);
    const first = completed[0].mean_lap_time_s!;
    const last = completed[completed.length - 1].mean_lap_time_s!;
    expect(first).toBeGreaterThan(last);
  });

  it.skipIf(!progressExists)('validated_record beats the autopilot baseline', () => {
    const { validated_record } = JSON.parse(
      readFileSync(PROGRESS_PATH, 'utf-8')
    ) as TrainingProgress;
    expect(validated_record.lap_time_s).toBeGreaterThan(0);
    expect(validated_record.autopilot_baseline_s).toBeGreaterThan(0);
    expect(validated_record.lap_time_s).toBeLessThan(validated_record.autopilot_baseline_s);
    expect(validated_record.speedup_pct).toBeGreaterThan(0);
  });

  it.skipIf(!progressExists || !existsSync(POLICY_PATH))(
    'documented record matches the actual Node-validated lap time within 0.1 s',
    () => {
      const { validated_record } = JSON.parse(
        readFileSync(PROGRESS_PATH, 'utf-8')
      ) as TrainingProgress;
      const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf-8')) as PolicyWeights;
      const result = runPolicyLap(policy, { maxSteps: 36000 });

      expect(result).not.toBeNull();
      if (result === null) return;

      const recordedS = validated_record.lap_time_s;
      const actualS = result.lapTimeMs / 1000;
      expect(Math.abs(recordedS - actualS)).toBeLessThan(0.1);

      console.log(
        `Record: ${recordedS.toFixed(2)} s documented  |  ` +
          `${actualS.toFixed(2)} s live  |  ` +
          `autopilot baseline: ${validated_record.autopilot_baseline_s} s`
      );
    },
    60_000,
  );
});
