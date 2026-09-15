/**
 * Bridge exposed by the Electron preload script (`desktop/src/preload.cjs`). Absent in
 * the browser build, so every access must be optional.
 */
interface DesktopBridge {
  /** WebSocket URL of the racing server, e.g. `wss://play.example.com`. */
  readonly serverUrl: string;
}

interface Window {
  readonly desktop?: DesktopBridge;
}
