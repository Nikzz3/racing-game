"""
PPO training on SunsetRidgeEnv + policy export to JSON.

Usage:
    python3 train.py [--timesteps N] [--envs N] [--output policy.json]

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


def _make_env(difficulty: str = "medium", max_steps: int = 3600):
    def _init():
        from env import SunsetRidgeEnv
        return SunsetRidgeEnv(difficulty=difficulty, eval_mode=False, max_steps=max_steps)
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


def train(
    timesteps: int = 1_000_000,
    n_envs: int = 8,
    output: str = "policy.json",
) -> None:
    from stable_baselines3 import PPO
    from stable_baselines3.common.vec_env import SubprocVecEnv, VecNormalize
    from stable_baselines3.common.callbacks import BaseCallback

    class LapLogger(BaseCallback):
        """Prints a progress line every 50k steps."""

        def __init__(self) -> None:
            super().__init__(verbose=0)
            self._last = 0

        def _on_step(self) -> bool:
            if self.num_timesteps - self._last >= 50_000:
                self._last = self.num_timesteps
                ep_info = self.model.ep_info_buffer
                if ep_info:
                    mean_rew = sum(e["r"] for e in ep_info) / len(ep_info)
                    print(
                        f"  steps={self.num_timesteps:>8d}  "
                        f"mean_ep_rew={mean_rew:>8.1f}"
                    )
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
    model.learn(total_timesteps=timesteps, callback=LapLogger())

    export_policy(model, env, output)
    env.close()
    print("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--timesteps", type=int, default=1_000_000)
    parser.add_argument("--envs",      type=int, default=8)
    parser.add_argument("--output",    type=str, default=str(ROOT / "policy.json"))
    args = parser.parse_args()
    train(timesteps=args.timesteps, n_envs=args.envs, output=args.output)
