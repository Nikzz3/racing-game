// Sandboxed preload (CommonJS). With `sandbox: true` the preload cannot use
// ESM or require arbitrary modules, so keep this file dependency-free.
const { contextBridge } = require("electron");

const PREFIX = "--server-url=";
const arg = process.argv.find((a) => a.startsWith(PREFIX));
const serverUrl = arg ? arg.slice(PREFIX.length) : "ws://localhost:8080";

// Contract with the client: `window.desktop?.serverUrl` overrides the WebSocket URL.
contextBridge.exposeInMainWorld("desktop", { serverUrl });
