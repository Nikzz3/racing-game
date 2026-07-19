// PROTOTYPE — throwaway. Floating variant switcher for the lobby Pacer-selection
// prototype. Three variants on the real lobby route, switchable via ?variant=A|B|C.
// Not for production: the bar is gated on import.meta.env.DEV.

export const PACER_VARIANTS: Record<string, string> = {
  A: "Stateful rows + start echo",
  B: "Pacer tray",
  C: "Grid-side picker",
};

export type PacerVariant = "A" | "B" | "C";

export function currentVariant(): PacerVariant {
  const v = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return v && v in PACER_VARIANTS ? (v as PacerVariant) : "A";
}

/**
 * Mounts the switcher pill inside `host` (so it shows/hides with the lobby).
 * Arrow keys cycle variants, but only while `isActive()` — the same keys steer
 * the car in a race. Switching reloads the page: the variant is applied at
 * Lobby construction, and a reload keeps every variant honest about its
 * initial state.
 */
export function mountPrototypeSwitcher(host: HTMLElement, isActive: () => boolean): void {
  if (!import.meta.env.DEV) return;
  const keys = Object.keys(PACER_VARIANTS);
  const cur = currentVariant();
  const bar = document.createElement("div");
  bar.className = "proto-switcher";
  bar.innerHTML = `
    <button type="button" class="proto-prev" aria-label="Previous variant">&larr;</button>
    <span class="proto-label">${cur} &mdash; ${PACER_VARIANTS[cur]}</span>
    <button type="button" class="proto-next" aria-label="Next variant">&rarr;</button>`;
  const go = (dir: number): void => {
    const next = keys[(keys.indexOf(cur) + dir + keys.length) % keys.length];
    const params = new URLSearchParams(location.search);
    params.set("variant", next);
    location.search = params.toString();
  };
  bar.querySelector(".proto-prev")!.addEventListener("click", () => go(-1));
  bar.querySelector(".proto-next")!.addEventListener("click", () => go(1));
  window.addEventListener("keydown", (e) => {
    if (!isActive()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
  });
  host.appendChild(bar);
}
