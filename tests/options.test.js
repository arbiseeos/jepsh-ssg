import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOverrides } from "../src/options.js";

describe("buildOverrides", () => {
  it("returns nothing when no flags were passed, so config files are not clobbered", () => {
    assert.deepEqual(buildOverrides({}), {});
  });

  it("converts flags to typed config values", () => {
    const overrides = buildOverrides({
      routes: "/,/users/:id[1,2]",
      port: "0",
      concurrency: "4",
      sitemap: true,
      excludeRoutes: "/api/*, /admin",
      browserArgs: "--a,--b",
      basePath: "",
    });
    assert.deepEqual(overrides, {
      routes: ["/", { path: "/users/:id", params: [{ id: "1" }, { id: "2" }] }],
      port: 0,
      concurrency: 4,
      sitemap: true,
      excludeRoutes: ["/api/*", "/admin"],
      browserArgs: ["--a", "--b"],
      basePath: "",
    });
  });

  it("passes 'auto' through for later detection", () => {
    assert.equal(buildOverrides({ routes: "auto" }).routes, "auto");
  });
});
