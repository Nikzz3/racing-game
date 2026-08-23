// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LobbyCallbacks } from './lobby';
import { Lobby } from './lobby';
import { CAR_VARIANTS, type LeaderboardEntry, type RoomInfo, type ReplayFrame } from '@racing/shared';
import type { ReferenceLap } from '../game/reference-lap';
import { formatMs } from '../util';

// The lobby bakes the AI Reference Lap through buildReferenceLap; mock it so
// tests control the bake's result (and its call count) without running the
// policy harness.
const { buildReferenceLapMock } = vi.hoisted(() => ({ buildReferenceLapMock: vi.fn() }));
vi.mock('../game/reference-lap', () => ({ buildReferenceLap: buildReferenceLapMock }));

const AI_FRAMES: ReplayFrame[] = [
  [0, 0, 0, 0, 0],
  [1000 / 60, 0.5, 0.1, 0.01, 3],
];

function makeReferenceLap(timeMs = 23800): ReferenceLap {
  return { name: 'AI Record', variant: 'police', track: 'sunset-ridge', timeMs, frames: AI_FRAMES };
}

beforeEach(() => {
  buildReferenceLapMock.mockReset();
  buildReferenceLapMock.mockReturnValue(makeReferenceLap());
});

function makeCallbacks(): LobbyCallbacks {
  return {
    onCreate: vi.fn(),
    onJoin: vi.fn(),
    onReplay: vi.fn(),
    onReferenceLap: vi.fn(),
    onVariantChange: vi.fn(),
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

  function picker(): HTMLSelectElement {
    return parent.querySelector<HTMLSelectElement>('.pacer-select')!;
  }

  /** Selects the option naming `name` (or "No Pacer" when null) and fires change. */
  function pickPacer(name: string | null): void {
    const sel = picker();
    sel.value = name === null
      ? '-1'
      : [...sel.options].find(o => o.textContent!.includes(name))!.value;
    sel.dispatchEvent(new Event('change'));
  }

  it('picker lives in the Starting Grid panel', () => {
    expect(parent.querySelector('.panel-rooms .pacer-select')).not.toBeNull();
  });

  it('non-replay row shows no Watch button', () => {
    const bobRow = [...parent.querySelectorAll('.lb-list li')].find(li => li.textContent!.includes('Bob'));
    expect(bobRow!.querySelector('button[data-replay]')).toBeNull();
  });

  it('armedPacer is null and "No Pacer" selected initially', () => {
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe('-1');
  });

  it('offers only replay-bearing entries', () => {
    const texts = [...picker().options].map(o => o.textContent!);
    expect(texts.some(t => t.includes('Alice'))).toBe(true);
    expect(texts.some(t => t.includes('Carol'))).toBe(true);
    expect(texts.some(t => t.includes('Bob'))).toBe(false);
  });

  it('options show a formatted lap time', () => {
    const alice = [...picker().options].find(o => o.textContent!.includes('Alice'))!;
    expect(alice.textContent).toContain('1:02');
  });

  it('picking an entry arms it as a kind:"replay" Pacer', () => {
    pickPacer('Alice');
    expect(lobby.armedPacer).toEqual({
      kind: 'replay',
      name: 'Alice',
      track: 'sunset-ridge',
      difficulty: 'medium',
      entry: replayEntry,
    });
  });

  it('picking "No Pacer" clears the armed entry', () => {
    pickPacer('Alice');
    pickPacer(null);
    expect(lobby.armedPacer).toBeNull();
  });

  it('picking a new entry replaces the previous one', () => {
    pickPacer('Alice');
    pickPacer('Carol');
    expect(lobby.armedPacer).toMatchObject({ kind: 'replay', entry: replayEntry2 });
  });

  it('only offers entries matching selected Track and Difficulty', () => {
    const otherTrackEntry: LeaderboardEntry = {
      name: 'Dave', timeMs: 60000, date: '2026-01-04', hasReplay: true, difficulty: 'medium', track: 'stormhaven',
    };
    lobby.setLeaderboard([replayEntry, otherTrackEntry]);
    // Default view is sunset-ridge / medium — Dave (stormhaven) should not be offered
    const texts = [...picker().options].map(o => o.textContent!);
    expect(texts.some(t => t.includes('Alice'))).toBe(true);
    expect(texts.some(t => t.includes('Dave'))).toBe(false);
  });

  it('switching Track clears the armed Pacer and resets the picker', () => {
    pickPacer('Alice');
    parent.querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!.click();
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe('-1');
  });

  it('the armed Pacer survives a leaderboard refresh with new entry objects', () => {
    pickPacer('Alice');
    lobby.setLeaderboard([{ ...replayEntry }, noReplayEntry, replayEntry2]);
    expect(lobby.armedPacer).toMatchObject({ kind: 'replay', entry: replayEntry });
    expect(picker().value).not.toBe('-1');
  });

  it('is disabled when no entry has a replay and the AI is ineligible', () => {
    parent.querySelector<HTMLButtonElement>('button[data-diff="hard"]')!.click();
    lobby.setLeaderboard([{ ...noReplayEntry, difficulty: 'hard' }]);
    expect(picker().disabled).toBe(true);
  });

  it('is enabled with no replay-bearing entries when the AI option is offered', () => {
    lobby.setLeaderboard([noReplayEntry]);
    expect(picker().disabled).toBe(false);
  });
});

describe('Lobby AI Record Pacer option', () => {
  let parent: HTMLElement;
  let lobby: Lobby;

  const alice: LeaderboardEntry = {
    name: 'Alice', timeMs: 22000, date: '2026-01-01', hasReplay: true, difficulty: 'medium', track: 'sunset-ridge',
  };
  const carol: LeaderboardEntry = {
    name: 'Carol', timeMs: 63000, date: '2026-01-03', hasReplay: true, difficulty: 'medium', track: 'sunset-ridge',
  };

  beforeEach(() => {
    parent = makeParent();
  });
  afterEach(() => parent.remove());

  function makeLobby(): Lobby {
    lobby = new Lobby(parent, makeCallbacks());
    return lobby;
  }

  function picker(): HTMLSelectElement {
    return parent.querySelector<HTMLSelectElement>('.pacer-select')!;
  }

  function aiOption(): HTMLOptionElement | undefined {
    return [...picker().options].find((o) => o.value === 'ai');
  }

  function pick(value: string): void {
    picker().value = value;
    picker().dispatchEvent(new Event('change'));
  }

  it('offers the AI Record with the baked time when eligible', () => {
    buildReferenceLapMock.mockReturnValue(makeReferenceLap(24680));
    makeLobby();
    const opt = aiOption();
    expect(opt).toBeDefined();
    // The displayed time is the bake's, never a literal.
    expect(opt!.textContent).toBe(`⚑ AI Record — ${formatMs(24680)}`);
  });

  it('is styled to match the Pacer cyan', () => {
    makeLobby();
    expect(aiOption()!.classList.contains('pacer-opt-ai')).toBe(true);
  });

  it('sits at its time-sorted position among the human options', () => {
    // Alice 22.0s < AI 23.8s < Carol 63.0s
    makeLobby().setLeaderboard([alice, carol]);
    const texts = [...picker().options].map((o) => o.textContent!);
    expect(texts).toEqual([
      'No Pacer — race alone',
      `⚑ Alice — ${formatMs(22000)}`,
      `⚑ AI Record — ${formatMs(23800)}`,
      `⚑ Carol — ${formatMs(63000)}`,
    ]);
  });

  it('is absent on a Track without a trained policy', () => {
    makeLobby();
    parent.querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!.click();
    expect(aiOption()).toBeUndefined();
  });

  it('is absent on a non-Medium Difficulty', () => {
    makeLobby();
    for (const diff of ['easy', 'hard']) {
      parent.querySelector<HTMLButtonElement>(`button[data-diff="${diff}"]`)!.click();
      expect(aiOption()).toBeUndefined();
    }
  });

  it('a null bake yields no AI option', () => {
    buildReferenceLapMock.mockReturnValue(null);
    makeLobby();
    expect(aiOption()).toBeUndefined();
  });

  it('selecting it arms a kind:"ai" Pacer whose frames are the memoized bake', () => {
    makeLobby();
    pick('ai');
    expect(lobby.armedPacer).toEqual({
      kind: 'ai',
      name: 'AI Record',
      track: 'sunset-ridge',
      difficulty: 'medium',
      variant: 'police',
      frames: AI_FRAMES,
    });
    // Same array, not a copy: the armed frames are the bake the time came from.
    expect((lobby.armedPacer as { frames: ReplayFrame[] }).frames).toBe(AI_FRAMES);
  });

  it('selecting a human option replaces an armed AI, and vice versa', () => {
    makeLobby().setLeaderboard([alice]);
    pick('ai');
    expect(lobby.armedPacer).toMatchObject({ kind: 'ai' });
    pick('0');
    expect(lobby.armedPacer).toMatchObject({ kind: 'replay', entry: alice });
    pick('ai');
    expect(lobby.armedPacer).toMatchObject({ kind: 'ai' });
  });

  it('switching Track to an ineligible context clears an armed AI Pacer', () => {
    makeLobby();
    pick('ai');
    parent.querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!.click();
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe('-1');
  });

  it('switching Difficulty to an ineligible context clears an armed AI Pacer', () => {
    makeLobby();
    pick('ai');
    parent.querySelector<HTMLButtonElement>('button[data-diff="hard"]')!.click();
    expect(lobby.armedPacer).toBeNull();
    expect(picker().value).toBe('-1');
  });

  it('an armed AI Pacer survives eligible re-renders (leaderboard refreshes)', () => {
    makeLobby();
    pick('ai');
    lobby.setLeaderboard([alice, carol]);
    expect(lobby.armedPacer).toMatchObject({ kind: 'ai' });
    expect(picker().value).toBe('ai');
  });

  it('bakes at most once across repeated renders', () => {
    makeLobby();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([alice, carol]);
    parent.querySelector<HTMLButtonElement>('button[data-diff="hard"]')!.click();
    parent.querySelector<HTMLButtonElement>('button[data-diff="medium"]')!.click();
    expect(buildReferenceLapMock).toHaveBeenCalledTimes(1);
  });

  it('does not bake again for ineligible renders', () => {
    makeLobby();
    parent.querySelector<HTMLButtonElement>('button[data-track="stormhaven"]')!.click();
    buildReferenceLapMock.mockClear();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([]);
    expect(buildReferenceLapMock).not.toHaveBeenCalled();
  });

  it('a null bake is memoized too', () => {
    buildReferenceLapMock.mockReturnValue(null);
    makeLobby();
    lobby.setLeaderboard([alice]);
    lobby.setLeaderboard([alice, carol]);
    expect(buildReferenceLapMock).toHaveBeenCalledTimes(1);
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

describe('Lobby Garage picker', () => {
  let parent: HTMLElement;
  let lobby: Lobby;
  let cbs: LobbyCallbacks;

  beforeEach(() => {
    localStorage.clear();
    parent = makeParent();
  });
  afterEach(() => {
    parent.remove();
    localStorage.clear();
  });

  function makeLobby(): Lobby {
    cbs = makeCallbacks();
    lobby = new Lobby(parent, cbs);
    return lobby;
  }

  function card(variant: string): HTMLButtonElement {
    return parent.querySelector<HTMLButtonElement>(`.garage-card[data-variant="${variant}"]`)!;
  }

  it('renders a card for each of the 8 Variants plus a Random tile', () => {
    makeLobby();
    expect(parent.querySelectorAll('.garage-card').length).toBe(CAR_VARIANTS.length + 1);
    for (const v of CAR_VARIANTS) {
      expect(card(v)).not.toBeNull();
    }
    expect(card('random')).not.toBeNull();
  });

  it('the grid sits between the difficulty picker and the Lobby columns', () => {
    makeLobby();
    const garage = parent.querySelector('.garage')!;
    expect(garage.previousElementSibling!.classList.contains('diff-picker')).toBe(true);
    expect(garage.nextElementSibling!.classList.contains('lobby-columns')).toBe(true);
  });

  it('cards carry the Variant display name, with no separate selected-state line', () => {
    makeLobby();
    expect(card('suv').textContent).toContain('SUV');
    expect(card('random').textContent).toContain('Random');
    expect(parent.querySelector('.garage-selected')).toBeNull();
  });

  it('pre-selects Random on first visit', () => {
    makeLobby();
    expect(card('random').classList.contains('active')).toBe(true);
    expect(parent.querySelectorAll('.garage-card.active').length).toBe(1);
  });

  it('picking a card stores the choice and moves the highlight', () => {
    makeLobby();
    card('suv').click();
    expect(localStorage.getItem('racer-variant')).toBe('suv');
    expect(card('suv').classList.contains('active')).toBe(true);
    expect(card('random').classList.contains('active')).toBe(false);
    expect(lobby.selectedVariant).toBe('suv');
  });

  it('a stored concrete Variant renders as the selected card', () => {
    localStorage.setItem('racer-variant', 'taxi');
    makeLobby();
    expect(card('taxi').classList.contains('active')).toBe(true);
    expect(lobby.selectedVariant).toBe('taxi');
  });

  it('a stored Random choice stays Random', () => {
    localStorage.setItem('racer-variant', 'random');
    makeLobby();
    expect(card('random').classList.contains('active')).toBe(true);
    expect(localStorage.getItem('racer-variant')).toBe('random');
  });

  it('an invalid stored value falls back to Random and overwrites the stored value', () => {
    localStorage.setItem('racer-variant', 'batmobile');
    makeLobby();
    expect(card('random').classList.contains('active')).toBe(true);
    expect(localStorage.getItem('racer-variant')).toBe('random');
  });

  it('Random resolves to a concrete member of CAR_VARIANTS, never the wire string "random"', () => {
    makeLobby();
    expect(CAR_VARIANTS).toContain(lobby.selectedVariant);
  });

  it('Random keeps a single roll for the connection', () => {
    makeLobby();
    const first = lobby.selectedVariant;
    card('suv').click();
    card('random').click();
    expect(lobby.selectedVariant).toBe(first);
  });

  it('a choice change triggers a hello re-send', () => {
    makeLobby();
    card('suv').click();
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(1);
    card('random').click();
    expect(cbs.onVariantChange).toHaveBeenCalledTimes(2);
  });

  it('clicking the already-selected card does not re-send hello', () => {
    makeLobby();
    card('random').click();
    expect(cbs.onVariantChange).not.toHaveBeenCalled();
  });

  it('painting thumbnails without WebGL leaves the cards name-only', () => {
    makeLobby();
    expect(() => lobby.paintGarageThumbnails()).not.toThrow();
    for (const img of parent.querySelectorAll<HTMLImageElement>('.garage-card img')) {
      expect(img.getAttribute('src')).toBeNull();
    }
  });
});
