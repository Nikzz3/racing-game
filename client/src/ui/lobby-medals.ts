import {
  MEDAL_LABELS,
  MEDALS,
  medalFor,
  nextMedal,
  type Medal,
  type MedalTimes,
} from "@racing/shared";
import { formatMs } from "../util";
import { medalBadge } from "./medal-art";

/** Padlock for locked Variants, in the Lobby's 16px line-icon style. */
export const LOCK_ICON =
  '<svg class="lock-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7.5" rx="1.4"/><path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7"/></svg>';

export function unlockCopy(medal: Medal): string {
  return `Earn ${medal === "author" ? "an" : "a"} ${MEDAL_LABELS[medal]} medal to unlock`;
}

/**
 * A board's four Medal targets, easiest first. Given the driver's best lap (null
 * before their first), each is marked earned, next (the easiest still unearned) or
 * unearned; without one they are a plain legend.
 */
export function medalTargets(times: MedalTimes, bestMs?: number | null): string {
  const next = bestMs === undefined ? null : nextMedal(times, bestMs);
  return MEDALS.map((medal) => {
    const state =
      bestMs === undefined
        ? "legend"
        : bestMs !== null && bestMs <= times[medal]
          ? "earned"
          : medal === next
            ? "next"
            : "unearned";
    const note =
      state === "next"
        ? '<span class="medal-target-tag">Next</span>'
        : state === "earned"
          ? '<span class="lobby-sr">earned</span>'
          : "";
    // The copy names each Medal, so its badge stays out of the accessibility tree.
    const badge = medalBadge(medal, "medal-target-badge", {
      decorative: true,
      empty: state === "next" || state === "unearned",
    });
    return `<li class="medal-target" data-medal="${medal}" data-state="${state}">${badge}<span class="medal-target-name">${MEDAL_LABELS[medal]}</span><span class="medal-target-time">${formatMs(times[medal])}</span>${note}</li>`;
  }).join("");
}

/** The driver's best lap on a board and the Medal it earned. */
export function medalSummary(times: MedalTimes, bestMs: number | null): string {
  if (bestMs === null)
    return '<span class="medal-best-label">Your best</span><span class="medal-best-time is-empty">No lap yet</span>';
  const medal = medalFor(times, bestMs);
  return `<span class="medal-best-label">Your best</span><span class="medal-best-time">${formatMs(bestMs)}</span>${
    medal
      ? `<span class="medal-best-medal" data-medal="${medal}">${medalBadge(medal, "medal-best-badge", { decorative: true })}${MEDAL_LABELS[medal]} medal</span>`
      : '<span class="medal-best-medal">No medal yet</span>'
  }`;
}
