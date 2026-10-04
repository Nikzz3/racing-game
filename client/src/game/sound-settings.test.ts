// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundSettings } from "./sound-settings";

afterEach(() => localStorage.clear());

describe("SoundSettings", () => {
  it("starts unmuted at 70% for a first-time visitor", () => {
    const settings = new SoundSettings();
    expect(settings.volume).toBe(70);
    expect(settings.muted).toBe(false);
    expect(settings.gain).toBeCloseTo(0.49);
  });

  it("remembers the volume and mute across reloads", () => {
    const first = new SoundSettings();
    first.setVolume(40);
    first.setMuted(true);
    const reloaded = new SoundSettings();
    expect(reloaded.volume).toBe(40);
    expect(reloaded.muted).toBe(true);
  });

  it("plays at the square of the volume, and silent while muted", () => {
    const settings = new SoundSettings();
    settings.setVolume(50);
    expect(settings.gain).toBeCloseTo(0.25);
    settings.toggleMuted();
    expect(settings.gain).toBe(0);
    settings.toggleMuted();
    expect(settings.gain).toBeCloseTo(0.25);
  });

  it("keeps the volume on the slider's steps and range", () => {
    const settings = new SoundSettings();
    settings.setVolume(43);
    expect(settings.volume).toBe(45);
    settings.setVolume(250);
    expect(settings.volume).toBe(100);
    settings.setVolume(-3);
    expect(settings.volume).toBe(0);
  });

  it("falls back to the default over a stored value it can't read", () => {
    localStorage.setItem("racer-volume", "loud");
    localStorage.setItem("racer-muted", "maybe");
    const settings = new SoundSettings();
    expect(settings.volume).toBe(70);
    expect(settings.muted).toBe(false);
  });

  it("tells subscribers about real changes only, until they unsubscribe", () => {
    const settings = new SoundSettings();
    const listener = vi.fn();
    const unsubscribe = settings.subscribe(listener);
    settings.setVolume(70);
    settings.setMuted(false);
    expect(listener).not.toHaveBeenCalled();
    settings.setVolume(20);
    settings.toggleMuted();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    settings.toggleMuted();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
