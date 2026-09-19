/**
 * Bridge exposed by the Electron preload script (`desktop/src/preload.cjs`). Absent in
 * the browser build, so every access must be optional.
 */
interface DesktopBridge {
  /** WebSocket URL of the racing server, e.g. `wss://play.example.com`. */
  readonly serverUrl: string;
  /** Installed desktop app version (semver, from desktop/package.json). Older preloads omit it. */
  readonly version?: string;
  /** In-app update bridge; absent on preloads that predate auto-updates. */
  readonly updates?: DesktopUpdates;
}

/** Snapshot of the auto-updater, mirrored from `desktop/src/main.ts`. */
type DesktopUpdateState =
  /** No check has completed since launch; `check()` starts one. */
  | { readonly status: "unchecked" }
  /** The last completed check found nothing newer. */
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  /** The updater cannot run in this install; `install()` opens the releases page. */
  | { readonly status: "unsupported" }
  | {
      readonly status: "available";
      readonly version: string;
      /**
       * `false` when the update can only be fetched by hand (unsigned macOS builds):
       * `install()` then opens the releases page instead of installing in place.
       */
      readonly canInstall: boolean;
    }
  | { readonly status: "downloading"; readonly version: string; readonly percent: number }
  | { readonly status: "downloaded"; readonly version: string }
  | { readonly status: "error"; readonly message: string };

interface DesktopUpdates {
  /** Current state, for renderers that load after the first check completed. */
  getState(): Promise<DesktopUpdateState>;
  /** Download when `available`, restart into the new version when `downloaded`. */
  install(): Promise<void>;
  /** Ask the updater to look for a newer release now (no-op while one is downloading). */
  check(): Promise<void>;
  /** Subscribe to state changes; returns an unsubscribe function. */
  onState(cb: (state: DesktopUpdateState) => void): () => void;
}

interface Window {
  readonly desktop?: DesktopBridge;
}
