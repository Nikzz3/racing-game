import { MEDAL_LABELS, type Medal } from "@racing/shared";

/**
 * Inline SVG artwork for one Medal tier, shared by the HUD and the Lobby.
 * PLACEHOLDER: a flat disc per tier until the real artwork lands.
 */
export function medalBadge(medal: Medal, className = ""): string {
  const fill = { bronze: "#b8733d", silver: "#c9d1d9", gold: "#f2c14e", author: "#46d3a6" }[medal];
  return `<svg class="medal-badge medal-${medal} ${className}" viewBox="0 0 64 64" role="img" aria-label="${MEDAL_LABELS[medal]} medal"><circle cx="32" cy="32" r="28" fill="${fill}"/></svg>`;
}
