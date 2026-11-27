import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOverrides } from "../src/options.js";

describe("buildOverrides", () => {
  it("returns nothing when no flags were passed, so config files are not clobbered", () => {
    assert.deepEqual(buildOverrides({}), {});
  });

  it("converts every flag to a typed config value", () => {
    const overrides = buildOverrides({
      routes: "/,/users/:id[1,2]",
      basePath: "",
      baseUrl: "https://example.com",
      inputDir: "dist",
      outDir: "out",
      port: "0",
      concurrency: "4",
      flatOutput: true,
      hydrate: true,
      hydrateBundle: "assets/app.js",
      framework: "svelte",
      batchSize: "20",
      incremental: true,
      timeout: "5000",
      inlineCss: true,
      sitemap: true,
      excludeRoutes: "/api/*, /admin",
      customSelectors: "#app > *, main",
      disableSandbox: true,
      browserArgs: "--a, --b",
    });

    assert.deepEqual(overrides, {
      routes: ["/", { path: "/users/:id", params: { id: ["1", "2"] } }],
      basePath: "",
      baseUrl: "https://example.com",
      inputDir: "dist",
      outDir: "out",
      port: 0,
      concurrency: 4,
      flatOutput: true,
      hydrate: true,
      hydrateBundle: "assets/app.js",
      framework: "svelte",
      batchSize: 20,
      incremental: true,
      timeout: 5000,
      inlineCss: true,
      sitemap: true,
      excludeRoutes: ["/api/*", "/admin"],
      customSelectors: ["#app > *", "main"],
      disableSandbox: true,
      browserArgs: ["--a", "--b"],
    });
  });

  it("passes 'auto' through for later detection", () => {
    assert.equal(buildOverrides({ routes: "auto" }).routes, "auto");
    assert.equal(buildOverrides({ routes: " auto " }).routes, "auto");
  });

  it("keeps an explicitly empty base path", () => {
    assert.equal(buildOverrides({ basePath: "" }).basePath, "");
  });
});
