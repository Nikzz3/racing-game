import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpHandler } from "./http";

const SCRIPT = `console.log(${JSON.stringify("sunset ridge ".repeat(200))});`;
let directory: string;
let server: Server;
let origin: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "racing-http-"));
  await mkdir(join(directory, "assets"));
  await mkdir(join(directory, "models"));
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Sunset Ridge</title>");
  await writeFile(join(directory, "assets", "index-DAASEgex.js"), SCRIPT);
  await writeFile(join(directory, "models", "track.glb"), Buffer.alloc(4096, 7));
  server = createServer(createHttpHandler(directory));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

describe("static client caching", () => {
  it("caches hashed build output forever and revalidates everything else", async () => {
    const script = await fetch(`${origin}/assets/index-DAASEgex.js`);
    expect(script.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    for (const path of ["/", "/models/track.glb", "/some/spa/route"]) {
      expect((await fetch(`${origin}${path}`)).headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("answers a matching validator with 304 and no body", async () => {
    const first = await fetch(`${origin}/models/track.glb`);
    expect(first.status).toBe(200);
    expect((await first.arrayBuffer()).byteLength).toBe(4096);
    const etag = first.headers.get("etag")!;
    const lastModified = first.headers.get("last-modified")!;

    const byTag = await fetch(`${origin}/models/track.glb`, { headers: { "If-None-Match": etag } });
    expect(byTag.status).toBe(304);
    expect(await byTag.text()).toBe("");
    const byDate = await fetch(`${origin}/models/track.glb`, {
      headers: { "If-Modified-Since": lastModified },
    });
    expect(byDate.status).toBe(304);
    const stale = await fetch(`${origin}/models/track.glb`, {
      headers: { "If-None-Match": 'W/"0-0"' },
    });
    expect(stale.status).toBe(200);
  });
});

describe("static client compression", () => {
  // Node's fetch decodes gzip transparently, so read the raw encoding over http.
  function raw(path: string, acceptEncoding: string) {
    return new Promise<{ headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
      request(`${origin}${path}`, { headers: { "Accept-Encoding": acceptEncoding } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      })
        .on("error", reject)
        .end();
    });
  }

  it("gzips text assets for clients that accept it", async () => {
    const { headers, body } = await raw("/assets/index-DAASEgex.js", "gzip, deflate, br");
    expect(headers["content-encoding"]).toBe("gzip");
    expect(headers.vary).toBe("Accept-Encoding");
    expect(body.length).toBeLessThan(SCRIPT.length / 4);
    expect(gunzipSync(body).toString()).toBe(SCRIPT);
  });

  it("sends identity bytes when gzip is absent or refused, and never gzips models", async () => {
    for (const encoding of ["identity", "gzip;q=0, br"]) {
      const { headers, body } = await raw("/assets/index-DAASEgex.js", encoding);
      expect(headers["content-encoding"]).toBeUndefined();
      expect(body.toString()).toBe(SCRIPT);
    }
    const model = await raw("/models/track.glb", "gzip");
    expect(model.headers["content-encoding"]).toBeUndefined();
    expect(model.body.length).toBe(4096);
  });
});
