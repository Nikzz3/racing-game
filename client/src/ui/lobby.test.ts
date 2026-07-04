// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LobbyCallbacks } from './lobby';
import { Lobby } from './lobby';

function makeCallbacks(): LobbyCallbacks {
  return {
    onCreate: vi.fn(),
    onJoin: vi.fn(),
    onReplay: vi.fn(),
    onReferenceLap: vi.fn(),
  };
}

describe('Lobby AI Record control', () => {
  let parent: HTMLElement;
  let cbs: LobbyCallbacks;
  let lobby: Lobby;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
    // suppress unused-var warning
    void lobby;
  });

  afterEach(() => {
    parent.remove();
  });

  it('AI Record control is present (visible) on the Medium board', () => {
    // DEFAULT_DIFFICULTY is medium, so Medium tab is active from the start.
    // Explicitly click Medium tab to ensure renderBoard fires.
    parent.querySelector<HTMLButtonElement>('button[data-board-diff="medium"]')!.click();
    const aiRecord = parent.querySelector<HTMLElement>('.lb-ai-record');
    expect(aiRecord).not.toBeNull();
    expect(aiRecord!.hidden).toBe(false);
  });

  it('AI Record control is absent (hidden) on the Easy board', () => {
    parent.querySelector<HTMLButtonElement>('button[data-board-diff="easy"]')!.click();
    const aiRecord = parent.querySelector<HTMLElement>('.lb-ai-record');
    expect(aiRecord).not.toBeNull();
    expect(aiRecord!.hidden).toBe(true);
  });

  it('AI Record control is absent (hidden) on the Hard board', () => {
    parent.querySelector<HTMLButtonElement>('button[data-board-diff="hard"]')!.click();
    const aiRecord = parent.querySelector<HTMLElement>('.lb-ai-record');
    expect(aiRecord).not.toBeNull();
    expect(aiRecord!.hidden).toBe(true);
  });

  it('clicking the AI Record button invokes the onReferenceLap callback', () => {
    // Ensure Medium tab is active so the button is visible.
    parent.querySelector<HTMLButtonElement>('button[data-board-diff="medium"]')!.click();
    const btn = parent.querySelector<HTMLButtonElement>('button[data-ai-record]');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(cbs.onReferenceLap).toHaveBeenCalledOnce();
  });

  it('onReferenceLap is not triggered by clicks on other leaderboard elements', () => {
    parent.querySelector<HTMLButtonElement>('button[data-board-diff="medium"]')!.click();
    // Click on the list itself (no replay or AI record button).
    parent.querySelector<HTMLElement>('.lb-list')!.click();
    expect(cbs.onReferenceLap).not.toHaveBeenCalled();
  });
});
