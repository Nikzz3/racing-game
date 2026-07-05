// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LobbyCallbacks } from './lobby';
import { Lobby } from './lobby';
import type { LeaderboardEntry, RoomInfo } from '@racing/shared';

function makeCallbacks(): LobbyCallbacks {
  return {
    onCreate: vi.fn(),
    onJoin: vi.fn(),
    onReplay: vi.fn(),
    onReferenceLap: vi.fn(),
  };
}

function makeParent(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('Lobby track selector cards', () => {
  let parent: HTMLElement;
  let lobby: Lobby;
  let cbs: LobbyCallbacks;

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
  });
  afterEach(() => parent.remove());

  it('renders a card for each registered track', () => {
    expect(parent.querySelector('button[data-track="sunset-ridge"]')).not.toBeNull();
    expect(parent.querySelector('button[data-track="stormhaven"]')).not.toBeNull();
  });

  it('Sunset Ridge card is active by default', () => {
    expect(parent.querySelector<HTMLElement>('button[data-track="sunset-ridge"]')!.classList.contains('active')).toBe(true);
    expect(parent.querySelector<HTMLElement>('button[data-track="stormhaven"]')!.classList.contains('active')).toBe(false);
  });

  it('clicking Stormhaven marks it active and deactivates Sunset Ridge', () => {
    parent.querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!.click();
    expect(parent.querySelector<HTMLElement>('button[data-track="stormhaven"]')!.classList.contains('active')).toBe(true);
    expect(parent.querySelector<HTMLElement>('button[data-track="sunset-ridge"]')!.classList.contains('active')).toBe(false);
  });

  it('track cards contain the track name', () => {
    expect(parent.querySelector('button[data-track="sunset-ridge"]')!.textContent).toContain('Sunset Ridge Circuit');
    expect(parent.querySelector('button[data-track="stormhaven"]')!.textContent).toContain('Stormhaven Circuit');
  });

  it('selecting Stormhaven filters the leaderboard to Stormhaven entries', () => {
    const entries: LeaderboardEntry[] = [
      { name: 'Alice', timeMs: 60000, date: '2026-01-01', hasReplay: false, difficulty: 'medium', track: 'sunset-ridge' },
      { name: 'Bob',   timeMs: 65000, date: '2026-01-02', hasReplay: false, difficulty: 'medium', track: 'stormhaven' },
    ];
    lobby.setLeaderboard(entries);
    parent.querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!.click();
    const lb = parent.querySelector('.lb-list')!.textContent ?? '';
    expect(lb).toContain('Bob');
    expect(lb).not.toContain('Alice');
  });
});

describe('Lobby unified difficulty selector', () => {
  let parent: HTMLElement;
  let lobby: Lobby;
  let cbs: LobbyCallbacks;

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
  });
  afterEach(() => parent.remove());

  it('has a unified difficulty button for each difficulty', () => {
    expect(parent.querySelector('button[data-diff="easy"]')).not.toBeNull();
    expect(parent.querySelector('button[data-diff="medium"]')).not.toBeNull();
    expect(parent.querySelector('button[data-diff="hard"]')).not.toBeNull();
  });

  it('has no separate board-only difficulty tabs', () => {
    expect(parent.querySelector('button[data-board-diff]')).toBeNull();
  });

  it('clicking hard filters the leaderboard to hard entries', () => {
    const entries: LeaderboardEntry[] = [
      { name: 'Alice', timeMs: 60000, date: '2026-01-01', hasReplay: false, difficulty: 'medium', track: 'sunset-ridge' },
      { name: 'Bob',   timeMs: 55000, date: '2026-01-02', hasReplay: false, difficulty: 'hard',   track: 'sunset-ridge' },
    ];
    lobby.setLeaderboard(entries);
    parent.querySelector<HTMLButtonElement>('button[data-diff="hard"]')!.click();
    const lb = parent.querySelector('.lb-list')!.textContent ?? '';
    expect(lb).toContain('Bob');
    expect(lb).not.toContain('Alice');
  });
});

describe('Lobby create-room callback', () => {
  let parent: HTMLElement;
  let cbs: LobbyCallbacks;
  let lobby: Lobby;

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
  });
  afterEach(() => parent.remove());

  function submitForm(): void {
    parent.querySelector<HTMLFormElement>('.create-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
  }

  it('submitting the form calls onCreate with default track (sunset-ridge) and difficulty (medium)', () => {
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(expect.any(String), 'sunset-ridge', 'medium');
  });

  it('onCreate includes selected track after switching to Stormhaven', () => {
    parent.querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!.click();
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(expect.any(String), 'stormhaven', 'medium');
  });

  it('onCreate includes selected difficulty after switching to hard', () => {
    parent.querySelector<HTMLButtonElement>('button[data-diff="hard"]')!.click();
    submitForm();
    expect(cbs.onCreate).toHaveBeenCalledWith(expect.any(String), 'sunset-ridge', 'hard');
  });
});

describe('Lobby room list tracks', () => {
  let parent: HTMLElement;
  let lobby: Lobby;

  beforeEach(() => {
    parent = makeParent();
    lobby = new Lobby(parent, makeCallbacks());
  });
  afterEach(() => parent.remove());

  it('room rows show the track name for Stormhaven', () => {
    lobby.setRooms([
      { id: 'r1', name: 'Test Room', players: 2, difficulty: 'medium', track: 'stormhaven' } as RoomInfo,
    ]);
    expect(parent.querySelector('.room-list')!.textContent).toContain('Stormhaven Circuit');
  });

  it('room rows show the track name for Sunset Ridge', () => {
    lobby.setRooms([
      { id: 'r2', name: 'Another Room', players: 1, difficulty: 'hard', track: 'sunset-ridge' } as RoomInfo,
    ]);
    expect(parent.querySelector('.room-list')!.textContent).toContain('Sunset Ridge Circuit');
  });
});

describe('Lobby AI Record control', () => {
  let parent: HTMLElement;
  let cbs: LobbyCallbacks;

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    new Lobby(parent, cbs);
  });
  afterEach(() => parent.remove());

  it('is visible for Sunset Ridge + Medium (default state)', () => {
    expect(parent.querySelector<HTMLElement>('.lb-ai-record')!.hidden).toBe(false);
  });

  it('is hidden when Stormhaven is selected (no policy)', () => {
    parent.querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!.click();
    expect(parent.querySelector<HTMLElement>('.lb-ai-record')!.hidden).toBe(true);
  });

  it('is hidden when Easy is selected for Sunset Ridge', () => {
    parent.querySelector<HTMLButtonElement>('button[data-diff="easy"]')!.click();
    expect(parent.querySelector<HTMLElement>('.lb-ai-record')!.hidden).toBe(true);
  });

  it('is hidden when Hard is selected for Sunset Ridge', () => {
    parent.querySelector<HTMLButtonElement>('button[data-diff="hard"]')!.click();
    expect(parent.querySelector<HTMLElement>('.lb-ai-record')!.hidden).toBe(true);
  });

  it('clicking the AI Record button invokes onReferenceLap', () => {
    const btn = parent.querySelector<HTMLButtonElement>('button[data-ai-record]');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(cbs.onReferenceLap).toHaveBeenCalledOnce();
  });

  it('onReferenceLap is not triggered by clicks on other leaderboard elements', () => {
    parent.querySelector<HTMLElement>('.lb-list')!.click();
    expect(cbs.onReferenceLap).not.toHaveBeenCalled();
  });
});
