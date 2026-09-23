// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lobby } from "./lobby";

const stage = vi.hoisted(() => ({
  setActive: vi.fn(),
  setScreen: vi.fn(),
  setVariant: vi.fn(),
}));
vi.mock("./garage-stage", () => ({
  GarageStage: class {
    setActive = stage.setActive;
    setScreen = stage.setScreen;
    setVariant = stage.setVariant;
  },
}));
vi.mock("./track-stage", () => ({
  TrackStage: class {
    setActive() {}
    setTrack() {}
    release() {}
  },
}));
vi.mock("./garage-thumbs", () => ({
  renderVariantThumbnails: () => new Map(),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("persistent lobby garage", () => {
  it("keeps the background mounted and active through circuit and race setup", () => {
    const lobby = new Lobby(document.body, {
      onCreate: vi.fn(),
      onJoin: vi.fn(),
      onReplay: vi.fn(),
      onReferenceLap: vi.fn(),
      onVariantChange: vi.fn(),
    });
    lobby.paintGarageThumbnails();
    const background = document.querySelector(".live-car-stage");
    expect(background?.parentElement?.className).toBe("lobby-deck");
    expect(stage.setActive).toHaveBeenLastCalledWith(true);
    stage.setActive.mockClear();
    for (const [selector, screen] of [
      ["[data-select-car]", "track"],
      ["[data-select-track]", "settings"],
      ["[data-change-car]", "garage"],
    ]) {
      document.querySelector<HTMLButtonElement>(selector)!.click();
      expect(stage.setScreen).toHaveBeenLastCalledWith(screen);
      expect(document.querySelector(".live-car-stage")).toBe(background);
      expect(stage.setActive).not.toHaveBeenCalled();
    }
    lobby.hide();
    expect(stage.setActive).toHaveBeenLastCalledWith(false);
    lobby.show();
    expect(stage.setActive).toHaveBeenLastCalledWith(true);
  });

  it("does not redraw the garage when shown while already visible", () => {
    const lobby = new Lobby(document.body, {
      onCreate: vi.fn(),
      onJoin: vi.fn(),
      onReplay: vi.fn(),
      onReferenceLap: vi.fn(),
      onVariantChange: vi.fn(),
    });
    lobby.paintGarageThumbnails();
    stage.setActive.mockClear();
    lobby.show();
    expect(stage.setActive).not.toHaveBeenCalled();
  });
});
