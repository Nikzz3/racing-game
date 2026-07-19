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

describe('Lobby Pacer arming UX', () => {
  let parent: HTMLElement;
  let lobby: Lobby;
  let cbs: LobbyCallbacks;

  const replayEntry: LeaderboardEntry = {
    name: 'Alice', timeMs: 62340, date: '2026-01-01', hasReplay: true, difficulty: 'medium', track: 'sunset-ridge',
  };
  const noReplayEntry: LeaderboardEntry = {
    name: 'Bob', timeMs: 65000, date: '2026-01-02', hasReplay: false, difficulty: 'medium', track: 'sunset-ridge',
  };
  const replayEntry2: LeaderboardEntry = {
    name: 'Carol', timeMs: 63000, date: '2026-01-03', hasReplay: true, difficulty: 'medium', track: 'sunset-ridge',
  };

  beforeEach(() => {
    parent = makeParent();
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
    lobby.setLeaderboard([replayEntry, noReplayEntry, replayEntry2]);
  });
  afterEach(() => parent.remove());

  it('replay-bearing row shows a Pace button', () => {
    const aliceRow = [...parent.querySelectorAll('.lb-list li')].find(li => li.textContent!.includes('Alice'));
    expect(aliceRow!.querySelector('button[data-pace]')).not.toBeNull();
  });

  it('non-replay row shows no Pace button', () => {
    const bobRow = [...parent.querySelectorAll('.lb-list li')].find(li => li.textContent!.includes('Bob'));
    expect(bobRow!.querySelector('button[data-pace]')).toBeNull();
  });

  it('non-replay row shows no Watch button', () => {
    const bobRow = [...parent.querySelectorAll('.lb-list li')].find(li => li.textContent!.includes('Bob'));
    expect(bobRow!.querySelector('button[data-replay]')).toBeNull();
  });

  it('armed-pacer banner is hidden initially', () => {
    expect(parent.querySelector<HTMLElement>('.pacer-banner')!.hidden).toBe(true);
  });

  it('armedPacer is null initially', () => {
    expect(lobby.armedPacer).toBeNull();
  });

  it('clicking Pace shows the armed-pacer banner', () => {
    parent.querySelector<HTMLButtonElement>('button[data-pace="Alice"]')!.click();
    expect(parent.querySelector<HTMLElement>('.pacer-banner')!.hidden).toBe(false);
  });

  it('banner shows the entry name after arming', () => {
    parent.querySelector<HTMLButtonElement>('button[data-pace="Alice"]')!.click();
    expect(parent.querySelector('.pacer-banner')!.textContent).toContain('Alice');
  });

  it('banner shows a formatted lap time after arming', () => {
    parent.querySelector<HTMLButtonElement>('button[data-pace="Alice"]')!.click();
    expect(parent.querySelector('.pacer-banner')!.textContent).toContain('1:02');
  });

  it('armedPacer getter returns the armed entry', () => {
    parent.querySelector<HTMLButtonElement>('button[data-pace="Alice"]')!.click();
    expect(lobby.armedPacer).toEqual(replayEntry);
  });

  it('clicking the clear button hides the banner and nulls armedPacer', () => {
    parent.querySelector<HTMLButtonElement>('button[data-pace="Alice"]')!.click();
    parent.querySelector<HTMLButtonElement>('.pacer-clear')!.click();
    expect(parent.querySelector<HTMLElement>('.pacer-banner')!.hidden).toBe(true);
    expect(lobby.armedPacer).toBeNull();
  });

  it('arming a new entry replaces the previous one', () => {
    parent.querySelector<HTMLButtonElement>('button[data-pace="Alice"]')!.click();
    parent.querySelector<HTMLButtonElement>('button[data-pace="Carol"]')!.click();
    expect(lobby.armedPacer).toEqual(replayEntry2);
    expect(parent.querySelector('.pacer-banner')!.textContent).toContain('Carol');
    expect(parent.querySelector('.pacer-banner')!.textContent).not.toContain('Alice');
  });

  it('Pace buttons are only shown for entries matching selected Track and Difficulty', () => {
    const otherTrackEntry: LeaderboardEntry = {
      name: 'Dave', timeMs: 60000, date: '2026-01-04', hasReplay: true, difficulty: 'medium', track: 'stormhaven',
    };
    lobby.setLeaderboard([replayEntry, otherTrackEntry]);
    // Default view is sunset-ridge / medium — Dave (stormhaven) should not be visible
    const paceButtons = parent.querySelectorAll('button[data-pace]');
    const names = [...paceButtons].map(b => (b as HTMLButtonElement).dataset.pace);
    expect(names).toContain('Alice');
    expect(names).not.toContain('Dave');
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
