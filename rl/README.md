# Sunset Ridge RL

A Python port of the game's car physics (`physics.py`), a Gymnasium environment
(`env.py`), and a PPO trainer (`train.py`) that learns a driving policy and exports it
to `policy.json` for the TypeScript client to run.

## Installation

Requires **Python ≥ 3.11**. From the `rl/` directory, install the package with the
`train` extra (this pulls in the ML dependencies):

```bash
cd rl
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[train]"
```

Dependency groups (declared in `pyproject.toml`):

| Extra    | Packages                              | Needed for                          |
|----------|---------------------------------------|-------------------------------------|
| *(base)* | `numpy>=1.26`, `gymnasium>=1.0`       | the physics port + environment      |
| `train`  | `stable-baselines3>=2.0`, `onnxruntime>=1.15` | running `train.py`          |
| `dev`    | `pytest>=7`                           | running the test suite              |

To also run the tests, include the `dev` extra:

```bash
pip install -e ".[train,dev]"
```

## Running training

From the `rl/` directory (with the venv active):

```bash
python3 train.py
```

This runs PPO for 1,000,000 timesteps across 8 parallel environments and writes the
trained policy to `policy.json`. To also capture the reward log, eval-lap history, and
plateau analysis, pass `--progress`:

```bash
python3 train.py --progress training_progress.json
```

### Parameters

All parameters are optional. Note the committed `policy.json` was produced with a
**2,000,000-timestep** run, which is *not* the CLI default (`--timesteps` defaults to
`1000000`) — see [Reproducing the committed policy](#reproducing-the-committed-policy)
below.

| Flag                  | Type  | Default        | Description                                                                 |
|-----------------------|-------|----------------|-----------------------------------------------------------------------------|
| `--timesteps`         | int   | `1000000`      | Total PPO training timesteps.                                               |
| `--envs`              | int   | `8`            | Number of parallel environments (`SubprocVecEnv`).                          |
| `--output`            | str   | `policy.json`  | Path to write the exported policy JSON.                                     |
| `--progress`          | str   | *(none)*       | If set, write the reward log, eval laps, and plateau analysis to this path. |
| `--eval-freq`         | int   | `200000`       | Run 5 Python-env eval laps every N timesteps.                              |
| `--plateau-window`    | int   | `5`            | Number of recent reward checkpoints inspected for a plateau.                |
| `--plateau-threshold` | float | `1.5`          | Plateau triggers when the window varies by less than this percent.          |

Example — a quicker smoke run on fewer envs:

```bash
python3 train.py --timesteps 100000 --envs 4 --output policy_candidate.json
```

### Reproducing the committed policy

The committed `policy.json` comes from a 2,000,000-timestep run (Medium difficulty,
Node-validated lap of **23.82 s** — a **32.8%** speedup over the 35.47 s autopilot
baseline). To reproduce it:

```bash
python3 train.py --timesteps 2000000 --progress training_progress.json
```

The full hyperparameter and reward configuration is recorded in
[`train_config.json`](train_config.json) (PPO settings, network architecture,
environment/reward config, and the validated results). Training runs on CPU by default.

## Output

`train.py` exports a JSON policy the client evaluates as a plain MLP forward pass:

```
x = normalize(obs)                     # using obs_mean / obs_var
for each hidden layer:  x = tanh(W·x + b)
action = clip(W_out·x + b_out, -1, 1)
```

The file contains `obs_mean`, `obs_var`, `net_arch` (`[64, 64]`), `activation` (`tanh`),
and the per-layer `weight`/`bias` matrices.

## Validation

The eval laps produced during training use the Python physics port as a **proxy** — the
authoritative lap time comes from replaying the policy against the real TypeScript
`CarPhysics` in Node:

```bash
npm run test -w client
```

## Tests

With the `dev` extra installed, run the Python suite from `rl/`:

```bash
pytest
```

This covers the environment (`test_env.py`), the physics golden values (`test_golden.py`),
and plateau detection (`test_plateau.py`).
