export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "--:--.---";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(mil).padStart(3, "0")}`;
}

/** Signed split delta, e.g. "+0.234" / "−1.107" / "—" when no reference. */
export function formatDelta(ms: number | null): { text: string; cssClass: string } {
  if (ms === null) return { text: "—", cssClass: "delta-none" };
  const abs = Math.abs(ms);
  const sec = Math.floor(abs / 1000);
  const mil = Math.floor(abs % 1000);
  const body = `${sec}.${String(mil).padStart(3, "0")}`;
  if (ms < 0) return { text: `−${body}`, cssClass: "delta-faster" };
  return { text: `+${body}`, cssClass: "delta-slower" };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Stable small hash for picking car colors per player id. */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
