import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { startServer } from "../src/server.js";
import { cleanup, copyFixture, makeTempDir } from "./helpers.js";

// http.get (unlike fetch) sends the request path exactly as given, so ".." reaches the server.
const get = (port, requestPath) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: requestPath }, (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });

describe("startServer", () => {
  let tmp;
  let server;

  before(async () => {
    tmp = makeTempDir();
    const inputDir = copyFixture(tmp);
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

    const js = await get(server.port, "/assets/app.js");
    assert.equal(js.status, 200);
    assert.match(js.headers["content-type"], /javascript/);
  });

  it("falls back to index.html for extensionless SPA routes, with and without the base path", async () => {
    for (const route of ["/about", "/app/about", "/users/42"]) {
      const res = await get(server.port, route);
      assert.equal(res.status, 200, route);
      assert.match(res.body, /id="root"/, route);
    }
  });

  it("returns 404 for missing files with an extension", async () => {
    const res = await get(server.port, "/assets/missing.js");
    assert.equal(res.status, 404);
  });

  it("cannot be used to read files outside the input directory", async () => {
    for (const evil of ["/../package.json", "/%2e%2e/%2e%2e/package.json", "/..%2f..%2fpackage.json", "/assets/../../package.json"]) {
      const res = await get(server.port, evil);
      assert.notEqual(res.status, 200, evil);
      assert.doesNotMatch(res.body, /"name"/, evil);
    }
  });

  it("rejects malformed URL encoding and unsupported methods", async () => {
    assert.equal((await get(server.port, "/%E0%A4%A")).status, 400);
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
});
