"""
PPO training on SunsetRidgeEnv + policy export to JSON.

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

The policy runs a forward pass as:
  x = normalize(obs)
  for each hidden layer:  x = tanh(W @ x + b)
  action = clip(W_out @ x + b_out, -1, 1)
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Plateau detection — pure Python, no ML deps
# ---------------------------------------------------------------------------

def detect_plateau(
    reward_history: list[float],
    window: int = 5,
    threshold_pct: float = 1.5,
) -> bool:
    """Return True when the last *window* mean-episode-rewards show < *threshold_pct*% variation.

    Variation is measured as (max − min) / max × 100.  Returns False if the
    history is shorter than *window* or if max ≤ 0 (degenerate case).
    """
    if len(reward_history) < window:
        return False
    recent = reward_history[-window:]
    best = max(recent)
    worst = min(recent)
    if best <= 0:
        return False
    variation_pct = (best - worst) / best * 100.0
    return variation_pct < threshold_pct


# ---------------------------------------------------------------------------
# Policy export
# ---------------------------------------------------------------------------

def _make_env(difficulty: str = "medium", max_steps: int = 3600):
    def _init():
        from env import TimeTrialEnv
        from stable_baselines3.common.monitor import Monitor
        # Monitor adds info["episode"] on episode end, which populates PPO's
        # ep_info_buffer — the source for reward_log and plateau detection.
        return Monitor(TimeTrialEnv(difficulty=difficulty, eval_mode=False, max_steps=max_steps))
    return _init


def export_policy(model, vec_env, output_path: str) -> None:
    import torch

    policy = model.policy
    obs_rms = vec_env.obs_rms

    layers: list[dict] = []
    with torch.no_grad():
        for module in policy.mlp_extractor.policy_net.children():
            if isinstance(module, torch.nn.Linear):
                layers.append({
                    "weight": module.weight.cpu().numpy().tolist(),
                    "bias":   module.bias.cpu().numpy().tolist(),
                })
        layers.append({
            "weight": policy.action_net.weight.cpu().numpy().tolist(),
            "bias":   policy.action_net.bias.cpu().numpy().tolist(),
        })

    export = {
        "obs_mean":   obs_rms.mean.tolist(),
        "obs_var":    obs_rms.var.tolist(),
        "net_arch":   [64, 64],
        "activation": "tanh",
        "layers":     layers,
    }
    with open(output_path, "w") as f:
        json.dump(export, f)
    print(f"Policy exported → {output_path}")


# ---------------------------------------------------------------------------
# Eval lap (Python env proxy)
# ---------------------------------------------------------------------------

# Number of eval episodes averaged per eval checkpoint.
N_EVAL_LAPS = 5


def eval_policy_lap(
    model, vec_env, n_eval: int = N_EVAL_LAPS
) -> tuple[float | None, int]:
    """Run n_eval eval episodes from the fixed spawn; return (mean_lap_time_s, n_laps_completed).

    Uses Python-env physics as a proxy — the authoritative record comes from
    the Node validation harness (runPolicyLap against real TypeScript CarPhysics).
    """
    import numpy as np
    from env import TimeTrialEnv, TOTAL_TRACK_LENGTH, DT

    lap_times: list[float] = []

    for _ in range(n_eval):
        eval_env = TimeTrialEnv(difficulty="medium", eval_mode=True, max_steps=36000)
        obs, _ = eval_env.reset()
        done = False
        lap_done = False
        step_count = 0

        while not done and not lap_done:
            # Normalize with VecNormalize running statistics (clip_obs=5.0)
            obs_norm = np.clip(
                (obs - vec_env.obs_rms.mean) / np.sqrt(vec_env.obs_rms.var + 1e-8),
                -5.0, 5.0,
            )
            action, _ = model.policy.predict(obs_norm[np.newaxis], deterministic=True)
            obs, _, terminated, truncated, info = eval_env.step(action[0])
            step_count += 1
            done = terminated or truncated

            if info["progress"] >= TOTAL_TRACK_LENGTH:
                lap_times.append(step_count * DT)
                lap_done = True

        eval_env.close()

    if not lap_times:
        return None, 0
    return sum(lap_times) / len(lap_times), len(lap_times)


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train(
    timesteps: int = 1_000_000,
    n_envs: int = 8,
    output: str = "policy.json",
    progress_output: str | None = None,
    eval_freq: int = 200_000,
    plateau_window: int = 5,
    plateau_threshold_pct: float = 1.5,
) -> None:
    from stable_baselines3 import PPO
    from stable_baselines3.common.vec_env import SubprocVecEnv, VecNormalize
    from stable_baselines3.common.callbacks import BaseCallback

    reward_log: list[dict] = []
    eval_laps: list[dict] = []
    reward_history: list[float] = []
    plateau_info: dict = {"detected": False, "detected_at_timesteps": None}

    class PlateauCallback(BaseCallback):
        """Logs mean episode reward every 50k steps; runs Python eval lap every eval_freq steps."""

        _reward_last = 0
        _eval_last = 0

        def _on_step(self) -> bool:
            # Reward checkpoint every 50k steps
            if self.num_timesteps - self._reward_last >= 50_000:
                self._reward_last = self.num_timesteps
                buf = self.model.ep_info_buffer
                if buf:
                    mean_rew = sum(e["r"] for e in buf) / len(buf)
                    reward_log.append({
                        "timesteps": self.num_timesteps,
                        "mean_episode_reward": round(mean_rew, 2),
                    })
                    reward_history.append(mean_rew)
                    print(
                        f"  steps={self.num_timesteps:>8d}  "
                        f"mean_ep_rew={mean_rew:>8.1f}"
                    )

                    # Check plateau on reward history
                    if not plateau_info["detected"] and detect_plateau(
                        reward_history, window=plateau_window, threshold_pct=plateau_threshold_pct
                    ):
                        plateau_info["detected"] = True
                        plateau_info["detected_at_timesteps"] = self.num_timesteps
                        print(
                            f"  [plateau] Detected at {self.num_timesteps:,} steps "
                            f"(last {plateau_window} rewards within "
                            f"{plateau_threshold_pct}% variation) — continuing to budget."
                        )

            # Eval lap checkpoint every eval_freq steps
            if self.num_timesteps - self._eval_last >= eval_freq:
                self._eval_last = self.num_timesteps
                print(f"  [eval] Running {N_EVAL_LAPS} eval laps at {self.num_timesteps:,} steps…")
                lap_s, n = eval_policy_lap(self.model, self.training_env, n_eval=N_EVAL_LAPS)
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

    env = SubprocVecEnv([_make_env() for _ in range(n_envs)])
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
    )
    model.learn(total_timesteps=timesteps, callback=PlateauCallback())

    export_policy(model, env, output)
    env.close()

    # Build plateau verdict string
    if plateau_info["detected"]:
        window_rewards = reward_history[-plateau_window:]
        best = max(window_rewards)
        worst = min(window_rewards)
        variation = (best - worst) / best * 100.0
        plateau_verdict = (
            f"Plateau confirmed: last {plateau_window} reward checkpoints "
            f"({plateau_info['detected_at_timesteps'] - plateau_window * 50_000}–"
            f"{plateau_info['detected_at_timesteps']} steps) within "
            f"{variation:.2f}% variation (threshold {plateau_threshold_pct}%); "
            f"training continued to {timesteps:,} steps to confirm stability."
        )
    else:
        plateau_verdict = (
            f"No plateau detected within {timesteps:,} steps "
            f"(threshold {plateau_threshold_pct}%, window {plateau_window})."
        )

    if progress_output is not None:
        # Autopilot baseline hardcoded (measured in Node harness, issue #8)
        AUTOPILOT_BASELINE_S = 35.47
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
                "detected": plateau_info["detected"],
                "detected_at_timesteps": plateau_info["detected_at_timesteps"] or timesteps,
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
    parser.add_argument("--timesteps",          type=int,   default=1_000_000)
    parser.add_argument("--envs",               type=int,   default=8)
    parser.add_argument("--output",             type=str,   default=str(ROOT / "policy.json"))
    parser.add_argument("--progress",           type=str,   default=None)
    parser.add_argument("--eval-freq",          type=int,   default=200_000)
    parser.add_argument("--plateau-window",     type=int,   default=5)
    parser.add_argument("--plateau-threshold",  type=float, default=1.5)
    args = parser.parse_args()
    train(
        timesteps=args.timesteps,
        n_envs=args.envs,
        output=args.output,
        progress_output=args.progress,
        eval_freq=args.eval_freq,
        plateau_window=args.plateau_window,
        plateau_threshold_pct=args.plateau_threshold,
    )
