// With cookies or site data blocked, merely touching `localStorage` throws a
// SecurityError. These fall back to the caller's default and drop the write, so the
// game still starts and the driver's choices last until the page reloads.

export function loadSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked or full.
  }
}
