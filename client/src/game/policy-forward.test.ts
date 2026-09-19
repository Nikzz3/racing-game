import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { policyForward, type PolicyWeights } from "./harness";

// Independent reference for the training-compatible operation order. Tiny
// floating-point changes can alter subsequent steering and the recorded lap.
function referenceForward(obs: number[], policy: PolicyWeights): number[] {
  let x = obs.map((value, i) => {
    const normalized =
      (value - policy.obs_mean[i]) / Math.sqrt(policy.obs_var[i] + 1e-8);
    return Math.max(-5, Math.min(5, normalized));
  });
  policy.layers.forEach(({ weight, bias }, i) => {
    const previous = x;
    x = weight.map(
      (row, j) => row.reduce((sum, value, k) => sum + value * previous[k], 0) + bias[j],
    );
    if (i < policy.layers.length - 1) x = x.map(Math.tanh);
  });
  return x.map((value) => Math.max(-1, Math.min(1, value)));
}

const POLICY_URL = new URL("../../../rl/policy.json", import.meta.url);
const policy: PolicyWeights | null = existsSync(POLICY_URL)
  ? JSON.parse(readFileSync(POLICY_URL, "utf8"))
  : null;

describe.skipIf(!policy)("policyForward numerical compatibility", () => {
  it("preserves exact actions for normal and clipped observations", () => {
    for (let sample = 0; sample < 300; sample++) {
      const obs = Array.from({ length: policy!.obs_mean.length }, (_, index) =>
        Math.sin(sample * 0.7919 + index * 2.31) * (sample % 3 === 0 ? 20 : 3),
      );
      expect(policyForward(obs, policy!)).toEqual(referenceForward(obs, policy!));
    }
  });

  it("does not mutate observations or policy weights between calls", () => {
    const obs = [0, -1, 1, 2, -2, 3, -3];
    const frozenPolicy: PolicyWeights = structuredClone(policy!);
    frozenPolicy.layers.forEach(({ weight, bias }) => {
      weight.forEach(Object.freeze);
      Object.freeze(weight);
      Object.freeze(bias);
    });
    Object.freeze(obs);
    const first = policyForward(obs, frozenPolicy);
    policyForward([1, 1, 1, 1, 1, 1, 1], frozenPolicy);
    expect(policyForward(obs, frozenPolicy)).toEqual(first);
    expect(frozenPolicy).toEqual(policy);
  });
});
