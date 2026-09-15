// Sandboxed preload (CommonJS). With `sandbox: true` the preload cannot use
// ESM or require arbitrary modules, so keep this file dependency-free.
const { contextBridge, ipcRenderer } = require("electron");

function argValue(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const serverUrl = argValue("--server-url=") ?? "ws://localhost:8080";
// `app.getVersion()` is not reachable from a sandboxed preload, so the main
// process hands it over as an extra argument (see additionalArguments in main.ts).
const version = argValue("--app-version=") ?? "0.0.0";

// Contract with the client (see client/src/desktop.d.ts):
//   window.desktop.serverUrl  overrides the WebSocket URL
//   window.desktop.version    the installed app version
//   window.desktop.updates    in-app update state + install trigger
contextBridge.exposeInMainWorld("desktop", {
  serverUrl,
  version,
  updates: {
    getState: () => ipcRenderer.invoke("desktop:update:state"),
    install: () => ipcRenderer.invoke("desktop:update:install"),
    onState: (cb) => {
      const listener = (_event, state) => cb(state);
      ipcRenderer.on("desktop:update", listener);
      return () => ipcRenderer.removeListener("desktop:update", listener);
    },
  },
});
