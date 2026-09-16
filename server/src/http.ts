import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/** Serve the built client as a static SPA: unknown paths fall back to index.html. */
export function createHttpHandler(clientDirectory: string) {
  const root = resolve(clientDirectory);

  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const rawPath = (request.url ?? "/").split("?")[0];
    if (rawPath === "/healthz") {
      response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    if (path.includes("\0")) {
      response.writeHead(400).end("Bad request");
      return;
    }
    let file = resolve(root, `.${path}`);
    const within = relative(root, file);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      response.writeHead(403).end();
      return;
    }
    if (!(await isFile(file))) file = resolve(root, "index.html");
    if (!(await isFile(file))) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(file)] ?? "application/octet-stream",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on("error", (error) => {
      console.error("Failed to stream client asset:", error);
      response.destroy();
    });
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  }

  return (request: IncomingMessage, response: ServerResponse): void => {
    void serve(request, response).catch((error) => {
      console.error("Failed to serve client:", error);
      if (response.headersSent) response.destroy();
      else response.writeHead(500).end("Internal server error");
    });
  };
}
