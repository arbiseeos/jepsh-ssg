import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { crawlRoutes, startServer } from "../src/index.js";
import type { CrawlOptions, ServerHandle } from "../src/types.js";
import { cleanup, copyFixture, makeTempDir, needsNoSandbox } from "./helpers.js";

// Drives real headless Chrome through Puppeteer against a fixture that mimics Vite's build output.
describe("crawlRoutes (end to end)", { timeout: 300_000 }, () => {
  let tmp: string;
  let inputDir: string;
  let originalCwd: string;
  let server: ServerHandle;

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

  const options = (overrides: Partial<CrawlOptions> = {}): CrawlOptions => ({
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

  const read = (outDir: string, ...segments: string[]): string => fs.readFileSync(path.join(outDir, ...segments), "utf-8");

  it("pre-renders every route, honours excludeRoutes, loads the bundle once and writes a sitemap", async () => {
    const config = options({ hydrate: true, sitemap: true });
    const results = await crawlRoutes(config);

    assert.deepEqual(results.map((result) => result.status).sort(), ["success", "success", "success", "success"]);
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
      first.map((result) => result.status),
      ["success", "success"]
    );

    const second = await crawlRoutes(config);
    assert.deepEqual(
      second.map((result) => result.status),
      ["skipped", "skipped"]
    );
    assert.match(read(config.outDir, "index.html"), /<h1>Home page<\/h1>/, "rendered home page must survive the copy step");
    assert.match(read(config.outDir, "about", "index.html"), /<h1>About page<\/h1>/);

    // Changing the shell invalidates the cache.
    fs.appendFileSync(path.join(inputDir, "index.html"), "\n<!-- rebuilt -->\n");
    const third = await crawlRoutes(config);
    assert.deepEqual(
      third.map((result) => result.status),
      ["success", "success"]
    );
  });

  it("ignores an incremental cache written with different build options", async () => {
    const config = options({ outDir: path.join(tmp, "fingerprint"), incremental: true, routes: ["/"], customSelectors: ["#root > *"] });
    const first = await crawlRoutes(config);
    assert.equal(first[0]?.status, "success");

    const changed = await crawlRoutes({ ...config, framework: "vue" });
    assert.equal(changed[0]?.status, "success");
  });

  it("warns but keeps building when the hydration bundle is missing", async () => {
    const config = options({ outDir: path.join(tmp, "hydrate-missing"), hydrate: true, hydrateBundle: "assets/nope.js", routes: ["/"] });
    const results = await crawlRoutes(config);

    assert.equal(results[0]?.status, "success");
    const html = read(config.outDir, "index.html");
    assert.doesNotMatch(html, /assets\/nope\.js/);
    assert.match(html, /<h1>Home page<\/h1>/);
  });

  it("falls back to general content when no framework selector matches", async () => {
    const config = options({ outDir: path.join(tmp, "selectors"), customSelectors: ["#does-not-exist"], batchSize: 1, routes: ["/", "/about"] });
    const results = await crawlRoutes(config);

    assert.deepEqual(
      results.map((result) => result.status),
      ["success", "success"]
    );
  });

  it("inlines critical CSS", async () => {
    const config = options({ outDir: path.join(tmp, "inline"), inlineCss: true, routes: ["/"] });
    const results = await crawlRoutes(config);

    assert.equal(results[0]?.status, "success");
    assert.match(read(config.outDir, "index.html"), /<style/);
  });

  it("reports failures instead of throwing", async () => {
    // Port 1 refuses connections, so navigation fails for every route.
    const results = await crawlRoutes(options({ outDir: path.join(tmp, "failing"), routes: ["/about"], port: 1 }));
    assert.equal(results[0]?.status, "failed");
  });

  it("survives an unreadable and unwritable incremental cache", async () => {
    const cacheDir = path.join(tmp, ".jepsh/caches");
    const cachePath = path.join(cacheDir, "ssg.json");
    fs.rmSync(cachePath, { recursive: true, force: true });
    fs.mkdirSync(cachePath, { recursive: true });

    const config = options({ outDir: path.join(tmp, "bad-cache"), incremental: true, routes: ["/"] });
    const results = await crawlRoutes(config);

    assert.equal(results[0]?.status, "success");
  });
});
