import { createReadStream, type Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { constants, gzip } from "node:zlib";

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

/** Text formats worth gzipping; binary models and images barely shrink. */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".gltf"]);
/** Compressed copies are kept in memory, so only small files qualify. */
const MAX_COMPRESSED_SOURCE_BYTES = 8 * 1024 * 1024;
/** Vite's build output: `assets/<name>-<content hash>.<ext>`, never rewritten in place. */
const HASHED_ASSET = /^assets[/\\][^/\\]+-[\w-]{8}\.[a-z0-9]+$/i;

const gzipAsync = promisify(gzip);

async function statFile(path: string): Promise<Stats | null> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? stats : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/** size + mtime, the validator nginx and serve-static use; a deploy changes both. */
function entityTag(stats: Stats): string {
  return `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
}

const opaqueTag = (tag: string): string => tag.trim().replace(/^W\//, "");

function isFresh(request: IncomingMessage, etag: string, stats: Stats): boolean {
  const ifNoneMatch = request.headers["if-none-match"];
  if (ifNoneMatch !== undefined) {
    const current = opaqueTag(etag);
    return ifNoneMatch.split(",").some((tag) => tag.trim() === "*" || opaqueTag(tag) === current);
  }
  const ifModifiedSince = Date.parse(request.headers["if-modified-since"] ?? "");
  // HTTP dates have one-second resolution.
  return (
    !Number.isNaN(ifModifiedSince) && Math.floor(stats.mtimeMs / 1000) * 1000 <= ifModifiedSince
  );
}

/** True unless the client omits gzip or refuses it with `q=0`. */
function acceptsGzip(request: IncomingMessage): boolean {
  const header = request.headers["accept-encoding"] ?? "";
  return header.split(",").some((coding) => {
    const [name, ...params] = coding.split(";").map((part) => part.trim().toLowerCase());
    const q = params.find((param) => param.startsWith("q="));
    return name === "gzip" && (q === undefined || Number(q.slice(2)) > 0);
  });
}

/** Serve the built client as a static SPA: unknown paths fall back to index.html. */
export function createHttpHandler(clientDirectory: string) {
  const root = resolve(clientDirectory);
  // Each compressible file is gzipped once per version rather than per request.
  const compressed = new Map<string, { etag: string; body: Promise<Buffer> }>();

  function gzipped(file: string, etag: string): Promise<Buffer> {
    const cached = compressed.get(file);
    if (cached?.etag === etag) return cached.body;
    const body = readFile(file).then((source) =>
      gzipAsync(source, { level: constants.Z_BEST_COMPRESSION }),
    );
    compressed.set(file, { etag, body });
    body.catch(() => {
      if (compressed.get(file)?.body === body) compressed.delete(file);
    });
    return body;
  }

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
    let stats = await statFile(file);
    if (!stats) {
      file = resolve(root, "index.html");
      stats = await statFile(file);
    }
    if (!stats) {
      response.writeHead(404).end("Not found");
      return;
    }

    const extension = extname(file);
    const etag = entityTag(stats);
    const compressible = COMPRESSIBLE.has(extension) && stats.size <= MAX_COMPRESSED_SOURCE_BYTES;
    const headers: Record<string, string> = {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
      // Hashed build output can be cached forever; everything else (index.html,
      // the unhashed models) is revalidated so a deploy is picked up at once,
      // and an unchanged file costs a 304 instead of a full download.
      "Cache-Control": HASHED_ASSET.test(relative(root, file))
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      ETag: etag,
      "Last-Modified": stats.mtime.toUTCString(),
    };
    if (compressible) headers.Vary = "Accept-Encoding";
    if (isFresh(request, etag, stats)) {
      response.writeHead(304, headers).end();
      return;
    }

    if (compressible && acceptsGzip(request)) {
      const body = await gzipped(file, etag);
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = String(body.length);
      response.writeHead(200, headers);
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    headers["Content-Length"] = String(stats.size);
    response.writeHead(200, headers);
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
