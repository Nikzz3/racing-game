import { describe, it, expect, vi } from "vitest";
import { disposeRenderer } from "./scene";

describe("disposeRenderer", () => {
  it("calls forceContextLoss before dispose", () => {
    const calls: string[] = [];
    const renderer = {
      forceContextLoss: vi.fn(() => { calls.push("forceContextLoss"); }),
      dispose: vi.fn(() => { calls.push("dispose"); }),
    };
    disposeRenderer(renderer as never);
    expect(calls).toEqual(["forceContextLoss", "dispose"]);
  });

  it("calls both forceContextLoss and dispose exactly once", () => {
    const renderer = {
      forceContextLoss: vi.fn(),
      dispose: vi.fn(),
    };
    disposeRenderer(renderer as never);
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
