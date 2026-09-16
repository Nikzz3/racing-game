"""
PPO training on TimeTrialEnv and policy export to JSON.

Usage:
    python3 train.py [--timesteps N] [--envs N] [--output policy.json]
                     [--progress training_progress.json]
                     [--eval-freq 200000] [--plateau-window 5]
                     [--plateau-threshold 1.5]

Exported JSON layout:
  {
    "obs_mean":  [7 floats],
    "obs_var":   [7 floats],
    "net_arch":  [64, 64],
    "activation": "tanh",
    "layers":    [{"weight": [[...]], "bias": [...]}, ...]
  }

The client runs the forward pass as:
  x = normalize(obs)
  for each hidden layer:  x = tanh(W @ x + b)
  action = clip(W_out @ x + b_out, -1, 1)

ML imports are deferred into the functions that need them so that
tests/test_plateau.py can import detect_plateau with only pytest installed.
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

REWARD_LOG_EVERY = 50_000
N_EVAL_LAPS = 5
# Measured in the Node harness (issue #8).
AUTOPILOT_BASELINE_S = 35.47


def detect_plateau(reward_history, window=5, threshold_pct=1.5):
    """True when the last `window` mean episode rewards vary by less than
    `threshold_pct` percent ((max - min) / max); False for short histories or max <= 0."""
    if len(reward_history) < window:
        return False
    recent = reward_history[-window:]
    best = max(recent)
    if best <= 0:
        return False
    return (best - min(recent)) / best * 100.0 < threshold_pct


def _make_env(line_reward_coef, line_reward_sigma):
    def _init():
        from env import TimeTrialEnv
        from stable_baselines3.common.monitor import Monitor
        # Monitor adds info["episode"] on episode end, which populates PPO's
        # ep_info_buffer: the source for the reward log and plateau detection.
        return Monitor(TimeTrialEnv(
            line_reward_coef=line_reward_coef,
            line_reward_sigma=line_reward_sigma,
        ))
    return _init


def export_policy(model, vec_env, output_path):
    import torch

    policy = model.policy
    with torch.no_grad():
        linears = [m for m in policy.mlp_extractor.policy_net.children() if isinstance(m, torch.nn.Linear)]
        layers = [
            {"weight": m.weight.cpu().numpy().tolist(), "bias": m.bias.cpu().numpy().tolist()}
            for m in [*linears, policy.action_net]
        ]

    export = {
        "obs_mean": vec_env.obs_rms.mean.tolist(),
        "obs_var": vec_env.obs_rms.var.tolist(),
        "net_arch": [64, 64],
        "activation": "tanh",
        "layers": layers,
    }
    with open(output_path, "w") as f:
        json.dump(export, f)
    print(f"Policy exported → {output_path}")


def eval_policy_lap(model, vec_env):
    """Mean lap time over N_EVAL_LAPS deterministic episodes from the fixed spawn,
    as (mean_lap_time_s or None, laps_completed).

    Python-env physics is a proxy; the authoritative record comes from the Node
    harness (runPolicyLap against the real TypeScript CarPhysics).
    """
    import numpy as np
    from env import TimeTrialEnv, TOTAL_TRACK_LENGTH, DT

    lap_times = []
    for _ in range(N_EVAL_LAPS):
        eval_env = TimeTrialEnv(eval_mode=True, max_steps=36000)
        obs, _ = eval_env.reset()
        for step_count in range(1, eval_env.max_steps + 1):
            # Normalize with VecNormalize's running statistics (clip_obs=5.0).
            obs_norm = np.clip(
                (obs - vec_env.obs_rms.mean) / np.sqrt(vec_env.obs_rms.var + 1e-8),
                -5.0, 5.0,
            )
            action, _ = model.policy.predict(obs_norm[np.newaxis], deterministic=True)
            obs, _, terminated, truncated, info = eval_env.step(action[0])
            if info["progress"] >= TOTAL_TRACK_LENGTH:
                lap_times.append(step_count * DT)
                break
            if terminated or truncated:
                break
        eval_env.close()

    if not lap_times:
        return None, 0
    return sum(lap_times) / len(lap_times), len(lap_times)


def train(
    timesteps=1_000_000,
    n_envs=8,
    output="policy.json",
    progress_output=None,
    eval_freq=200_000,
    plateau_window=5,
    plateau_threshold_pct=1.5,
    seed=None,
    line_reward_coef=0.0,
    line_reward_sigma=3.0,
):
    from stable_baselines3 import PPO
    from stable_baselines3.common.vec_env import SubprocVecEnv, VecNormalize
    from stable_baselines3.common.callbacks import BaseCallback

    reward_log = []
    eval_laps = []
    reward_history = []
    plateau_at = None

    class PlateauCallback(BaseCallback):
        """Logs mean episode reward every REWARD_LOG_EVERY steps and runs proxy eval laps every eval_freq steps."""

        _reward_last = 0
        _eval_last = 0

        def _on_step(self):
            nonlocal plateau_at
            if self.num_timesteps - self._reward_last >= REWARD_LOG_EVERY:
                self._reward_last = self.num_timesteps
                buf = self.model.ep_info_buffer
                if buf:
                    mean_rew = sum(e["r"] for e in buf) / len(buf)
                    reward_log.append({
                        "timesteps": self.num_timesteps,
                        "mean_episode_reward": round(mean_rew, 2),
                    })
                    reward_history.append(mean_rew)
                    print(f"  steps={self.num_timesteps:>8d}  mean_ep_rew={mean_rew:>8.1f}")

                    if plateau_at is None and detect_plateau(
                        reward_history, window=plateau_window, threshold_pct=plateau_threshold_pct
                    ):
                        plateau_at = self.num_timesteps
                        print(
                            f"  [plateau] Detected at {plateau_at:,} steps "
                            f"(last {plateau_window} rewards within "
                            f"{plateau_threshold_pct}% variation) — continuing to budget."
                        )

            if self.num_timesteps - self._eval_last >= eval_freq:
                self._eval_last = self.num_timesteps
                print(f"  [eval] Running {N_EVAL_LAPS} eval laps at {self.num_timesteps:,} steps…")
                lap_s, n = eval_policy_lap(self.model, self.training_env)
                if lap_s is not None:
                    print(f"  [eval] mean lap = {lap_s:.2f} s  ({n} laps completed)")
                else:
                    print("  [eval] no laps completed yet")
                eval_laps.append({
                    "timesteps": self.num_timesteps,
                    "mean_lap_time_s": round(lap_s, 2) if lap_s is not None else None,
                    "n_laps": n,
                })

            return True

    print(f"Training PPO: {timesteps:,} timesteps, {n_envs} envs (SubprocVecEnv)")

    env = SubprocVecEnv([_make_env(line_reward_coef, line_reward_sigma) for _ in range(n_envs)])
    env = VecNormalize(env, norm_obs=True, norm_reward=True, clip_obs=5.0)

    model = PPO(
        "MlpPolicy",
        env,
        n_steps=1024,
        batch_size=256,
        n_epochs=10,
        gamma=0.99,
        learning_rate=3e-4,
        policy_kwargs={"net_arch": [64, 64]},
        verbose=0,
        device="cpu",
        seed=seed,
    )
    model.learn(total_timesteps=timesteps, callback=PlateauCallback())

    export_policy(model, env, output)
    env.close()

    if progress_output is not None:
        if plateau_at is not None:
            window_rewards = reward_history[-plateau_window:]
            best = max(window_rewards)
            variation = (best - min(window_rewards)) / best * 100.0
            plateau_verdict = (
                f"Plateau confirmed: last {plateau_window} reward checkpoints "
                f"({plateau_at - plateau_window * REWARD_LOG_EVERY}–{plateau_at} steps) within "
                f"{variation:.2f}% variation (threshold {plateau_threshold_pct}%); "
                f"training continued to {timesteps:,} steps to confirm stability."
            )
        else:
            plateau_verdict = (
                f"No plateau detected within {timesteps:,} steps "
                f"(threshold {plateau_threshold_pct}%, window {plateau_window})."
            )

        final_lap = eval_laps[-1]["mean_lap_time_s"] if eval_laps else None
        speedup = (
            round((AUTOPILOT_BASELINE_S - final_lap) / AUTOPILOT_BASELINE_S * 100, 1)
            if final_lap is not None else None
        )
        progress = {
            "_note": (
                "Training progress for the PPO run that produced policy.json. "
                "Reward log captured from PlateauCallback every 50k steps; "
                "eval_laps are Python-env proxy laps (approximate physics). "
                "The authoritative record is validated_record, run against the "
                "real TypeScript CarPhysics in Node."
            ),
            "training_run": {
                "algorithm": "PPO",
                "total_timesteps": timesteps,
                "n_envs": n_envs,
            },
            "reward_log": reward_log,
            "eval_laps": eval_laps,
            "plateau_analysis": {
                "detected": plateau_at is not None,
                "detected_at_timesteps": plateau_at or timesteps,
                "window_size": plateau_window,
                "threshold_pct": plateau_threshold_pct,
                "verdict": plateau_verdict,
            },
            "validated_record": {
                "lap_time_s": final_lap,
                "autopilot_baseline_s": AUTOPILOT_BASELINE_S,
                "speedup_pct": speedup,
                "validation": (
                    "Python-env proxy. Run `npm run test -w client` for the "
                    "authoritative Node-validated record against real TypeScript CarPhysics."
                ),
            },
        }
        with open(progress_output, "w") as f:
            json.dump(progress, f, indent=2)
        print(f"Training progress → {progress_output}")

    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--timesteps", type=int, default=1_000_000)
    parser.add_argument("--envs", type=int, default=8)
    parser.add_argument("--output", default=str(ROOT / "policy.json"))
    parser.add_argument("--progress", default=None)
    parser.add_argument("--eval-freq", type=int, default=200_000)
    parser.add_argument("--plateau-window", type=int, default=5)
    parser.add_argument("--plateau-threshold", type=float, default=1.5)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--line-reward-coef", type=float, default=0.0)
    parser.add_argument("--line-reward-sigma", type=float, default=3.0)
    args = parser.parse_args()
    train(
        timesteps=args.timesteps,
        n_envs=args.envs,
        output=args.output,
        progress_output=args.progress,
        eval_freq=args.eval_freq,
        plateau_window=args.plateau_window,
        plateau_threshold_pct=args.plateau_threshold,
        seed=args.seed,
        line_reward_coef=args.line_reward_coef,
        line_reward_sigma=args.line_reward_sigma,
    )
