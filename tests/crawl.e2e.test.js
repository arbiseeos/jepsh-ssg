import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { crawlRoutes, startServer } from "../src/index.js";
import { cleanup, copyFixture, makeTempDir, needsNoSandbox } from "./helpers.js";

// Drives real headless Chrome through Puppeteer against a fixture that mimics Vite's build output.
describe("crawlRoutes (end to end)", { timeout: 180_000 }, () => {
  let tmp;
  let inputDir;
  let originalCwd;
  let server;

  before(async () => {
    originalCwd = process.cwd();
    tmp = makeTempDir();
    process.chdir(tmp); // .jepsh/ cache and logs are written relative to the cwd
    inputDir = copyFixture(tmp);
    server = await startServer({ inputDir, port: 0, basePath: "" });
  });

  after(async () => {
    await server.close();
    process.chdir(originalCwd);
    cleanup(tmp);
  });

  const options = (overrides = {}) => ({
    routes: ["/", "/about", { path: "/users/:id", params: [{ id: 1 }, { id: 2 }] }, "/admin"],
    excludeRoutes: ["/admin"],
    basePath: "",
    baseUrl: "https://example.com",
    inputDir,
    outDir: path.join(tmp, "out"),
    port: server.port,
    concurrency: 2,
    framework: "vite",
    disableSandbox: needsNoSandbox(),
    ...overrides,
  });

  const read = (outDir, ...segments) => fs.readFileSync(path.join(outDir, ...segments), "utf-8");

  it("pre-renders every route, honours excludeRoutes, loads the bundle once and writes a sitemap", async () => {
    const config = options({ hydrate: true, sitemap: true });
    const results = await crawlRoutes(config);

    assert.deepEqual(results.map((r) => r.status).sort(), ["success", "success", "success", "success"]);
    assert.match(read(config.outDir, "index.html"), /<h1>Home page<\/h1>/);
    assert.match(read(config.outDir, "about", "index.html"), /<h1>About page<\/h1>/);
    assert.match(read(config.outDir, "users", "1", "index.html"), /<h1>User 1<\/h1>/);
    assert.match(read(config.outDir, "users", "2", "index.html"), /<h1>User 2<\/h1>/);
    assert.equal(fs.existsSync(path.join(config.outDir, "admin")), false);

    const aboutHtml = read(config.outDir, "about", "index.html");
    assert.equal(aboutHtml.split('src="/assets/app.js"').length - 1, 1, "bundle script must appear exactly once");

    const sitemap = read(config.outDir, "sitemap.xml");
    assert.match(sitemap, /https:\/\/example\.com\/users\/2/);
    assert.doesNotMatch(sitemap, /admin/);
  });

  it("supports flat output", async () => {
    const config = options({ outDir: path.join(tmp, "flat"), flatOutput: true, routes: ["/", "/about"] });
    await crawlRoutes(config);
    assert.match(read(config.outDir, "about.html"), /<h1>About page<\/h1>/);
  });

  it("incremental builds skip unchanged routes without losing their rendered output", async () => {
    const config = options({ outDir: path.join(tmp, "incremental"), incremental: true, routes: ["/", "/about"] });

    const first = await crawlRoutes(config);
    assert.deepEqual(
      first.map((r) => r.status),
      ["success", "success"]
    );

    const second = await crawlRoutes(config);
    assert.deepEqual(
      second.map((r) => r.status),
      ["skipped", "skipped"]
    );
    assert.match(read(config.outDir, "index.html"), /<h1>Home page<\/h1>/, "rendered home page must survive the copy step");
    assert.match(read(config.outDir, "about", "index.html"), /<h1>About page<\/h1>/);

    // Changing the shell invalidates the cache.
    fs.appendFileSync(path.join(inputDir, "index.html"), "\n<!-- rebuilt -->\n");
    const third = await crawlRoutes(config);
    assert.deepEqual(
      third.map((r) => r.status),
      ["success", "success"]
    );
  });

  it("reports failures instead of throwing", async () => {
    // Port 1 refuses connections, so navigation fails for every route.
    const results = await crawlRoutes(options({ outDir: path.join(tmp, "failing"), routes: ["/about"], port: 1 }));
    assert.equal(results[0].status, "failed");
  });
});
