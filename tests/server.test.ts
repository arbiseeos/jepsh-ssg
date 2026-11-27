import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { startServer } from "../src/server.js";
import type { ServerHandle } from "../src/types.js";
import { cleanup, copyFixture, makeTempDir } from "./helpers.js";

type Response = { status: number | undefined; headers: http.IncomingHttpHeaders; body: string };

const request = (port: number, requestPath: string, method = "GET", headers: http.OutgoingHttpHeaders = {}): Promise<Response> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });

// http.get (unlike fetch) sends the request path exactly as given, so ".." reaches the server.
const get = (port: number, requestPath: string): Promise<Response> => request(port, requestPath);

describe("startServer", () => {
  let tmp: string;
  let server: ServerHandle;

  before(async () => {
    tmp = makeTempDir();
    const inputDir = copyFixture(tmp);
    fs.mkdirSync(path.join(inputDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(inputDir, "docs/index.html"), "<html><body><h1>Docs</h1></body></html>");
    fs.writeFileSync(path.join(inputDir, "about.html"), "<html><body><h1>Flat about</h1></body></html>");
    fs.writeFileSync(path.join(inputDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    server = await startServer({ inputDir, port: 0, basePath: "/app" });
  });

  after(async () => {
    await server.close();
    cleanup(tmp);
  });

  it("serves index.html and static assets with correct types", async () => {
    const index = await get(server.port, "/");
    assert.equal(index.status, 200);
    assert.match(index.body, /id="root"/);
    assert.match(String(index.headers["content-type"]), /text\/html/);
    assert.equal(index.headers["cache-control"], "no-cache");
    assert.ok(index.headers["last-modified"]);

    const js = await get(server.port, "/assets/app.js");
    assert.equal(js.status, 200);
    assert.match(String(js.headers["content-type"]), /javascript/);

    const png = await get(server.port, "/logo.png");
    assert.equal(png.status, 200);
    assert.equal(png.headers["cache-control"], "public, max-age=31536000");
  });

  it("falls back to index.html for extensionless SPA routes, with and without the base path", async () => {
    for (const route of ["/users/42", "/app", "/app/", "/missing?query=1#hash"]) {
      const res = await get(server.port, route);
      assert.equal(res.status, 200, route);
      assert.match(res.body, /id="root"/, route);
    }
  });

  it("serves directory indexes and flat .html files", async () => {
    for (const route of ["/docs", "/docs/", "/app/docs"]) {
      const res = await get(server.port, route);
      assert.equal(res.status, 200, route);
      assert.match(res.body, /<h1>Docs<\/h1>/, route);
    }

    const flat = await get(server.port, "/about");
    assert.equal(flat.status, 200);
    assert.match(flat.body, /<h1>Flat about<\/h1>/);
  });

  it("supports HEAD", async () => {
    const res = await request(server.port, "/assets/app.js", "HEAD");
    assert.equal(res.status, 200);
    assert.equal(res.body, "");
    assert.ok(Number(res.headers["content-length"]) > 0);
  });

  it("answers conditional requests with 304 for assets but not for HTML", async () => {
    const asset = await get(server.port, "/assets/app.js");
    const cached = await request(server.port, "/assets/app.js", "GET", { "if-modified-since": String(asset.headers["last-modified"]) });
    assert.equal(cached.status, 304);
    assert.equal(cached.body, "");

    const html = await get(server.port, "/about");
    const htmlCached = await request(server.port, "/about", "GET", { "if-modified-since": String(html.headers["last-modified"]) });
    assert.equal(htmlCached.status, 200);
    assert.match(htmlCached.body, /Flat about/);
  });

  it("returns 404 for missing files with an extension", async () => {
    const res = await get(server.port, "/assets/missing.js");
    assert.equal(res.status, 404);
    assert.match(res.body, /Not found/);
    assert.match(res.body, /Ensure the file exists/);
  });

  it("cannot be used to read files outside the input directory", async () => {
    for (const evil of ["/../package.json", "/%2e%2e/%2e%2e/package.json", "/..%2f..%2fpackage.json", "/assets/../../package.json"]) {
      const res = await get(server.port, evil);
      assert.notEqual(res.status, 200, evil);
      assert.doesNotMatch(res.body, /"name"/, evil);
    }
  });

  it("rejects malformed URL encoding, NUL bytes and unsupported methods", async () => {
    assert.equal((await get(server.port, "/%E0%A4%A")).status, 400);
    assert.equal((await get(server.port, "/%00")).status, 400);

    const res = await request(server.port, "/", "POST");
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, "GET, HEAD");
    assert.match(res.body, /Method Not Allowed/);
  });
});

describe("startServer errors", () => {
  it("rejects when the input directory has no index.html", async () => {
    const tmp = makeTempDir();
    try {
      await assert.rejects(startServer({ inputDir: tmp, port: 0 }), /missing index\.html/);
    } finally {
      cleanup(tmp);
    }
  });

  it("rejects when the port is already in use", async () => {
    const tmp = makeTempDir();
    try {
      const inputDir = copyFixture(tmp);
      const first = await startServer({ inputDir, port: 0 });
      try {
        await assert.rejects(startServer({ inputDir, port: first.port }), /EADDRINUSE/);
      } finally {
        await first.close();
      }
    } finally {
      cleanup(tmp);
    }
  });
});
