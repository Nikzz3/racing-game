import { MEDAL_LABELS, VARIANT_LABELS, type Medal, type Variant } from "@racing/shared";
import { formatMs } from "../util";
import { medalBadge } from "./medal-art";

/** How long an award stays up; its CSS fade-out ends here. */
export const AWARD_MS = 4200;

/** The celebration grows with the tier: more confetti, flung further. */
const BURST: Record<Medal, { count: number; reach: number }> = {
  bronze: { count: 14, reach: 0.7 },
  silver: { count: 22, reach: 0.85 },
  gold: { count: 32, reach: 1 },
  author: { count: 48, reach: 1.25 },
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Confetti spread evenly round the medal; CSS flings each piece to its offset, then drops it. */
function confetti(medal: Medal): string {
  const { count, reach } = BURST[medal];
  return Array.from({ length: count }, (_, i) => {
    const distance = (90 + ((i * 37) % 11) * 11) * reach;
    const x = Math.cos(i * GOLDEN_ANGLE) * distance;
    const y = Math.sin(i * GOLDEN_ANGLE) * distance * 0.75 - 30;
    return `<i style="--x:${Math.round(x)}px;--y:${Math.round(y)}px;--r:${((i * 5) % 7) * 150 - 450}deg;--d:${(i % 5) * 45}ms"></i>`;
  }).join("");
}

/**
 * The medal award overlay: the tier's medal drops in spinning, a shine sweeps across
 * it over turning light rays and a confetti burst, above the title, the lap time and
 * any cars the Medal unlocked. CSS-only and non-blocking; it never takes pointer input.
 */
export function medalAward(medal: Medal, lapMs: number, unlocked: readonly Variant[]): HTMLElement {
  const award = document.createElement("div");
  award.className = `medal-award medal-award-${medal}`;
  const cars = unlocked.map((variant) => VARIANT_LABELS[variant]);
  const unlock = cars.length
    ? `<p class="medal-award-unlock">New car${cars.length > 1 ? "s" : ""} unlocked: <b>${cars.join(", ")}</b></p>`
    : "";
  award.innerHTML = `<div class="medal-award-stage"><div class="medal-award-rays"></div><div class="medal-award-rings"></div><div class="medal-award-confetti">${confetti(medal)}</div>${medalBadge(medal, "medal-award-badge", { decorative: true })}</div><p class="medal-award-title"><span>${MEDAL_LABELS[medal]} medal</span></p><p class="medal-award-time">${formatMs(lapMs)}</p>${unlock}`;
  return award;
}
