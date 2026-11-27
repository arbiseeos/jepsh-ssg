import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { cleanup, copyFixture, makeTempDir } from "./helpers.js";

describe("loadConfig", () => {
  let cwd;

  before(() => {
    cwd = makeTempDir();
    copyFixture(cwd);
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "host", type: "module" }));
  });
  after(() => cleanup(cwd));

  const load = (overrides = {}, extra = {}) => loadConfig({ cwd, interactive: false, overrides: { inputDir: "dist", ...overrides }, ...extra });

  it("applies defaults when no config file exists and flags were given", async () => {
    const config = await load({ framework: "vite" });
    assert.deepEqual(config.routes, ["/"]);
    assert.equal(config.framework, "vite");
    assert.equal(config.port, 3000);
  });

  it("lets CLI overrides win over jepsh.config.js and keeps the file's other values", async () => {
    const file = path.join(cwd, "jepsh.config.js");
    fs.writeFileSync(file, `export default { ssg: { routes: ["/", "/about"], concurrency: 7, inputDir: "dist" } };\n`);
    try {
      const config = await load({ concurrency: 2 });
      assert.equal(config.concurrency, 2);
      assert.deepEqual(config.routes, ["/", "/about"]);
    } finally {
      fs.rmSync(file);
    }
  });

  it("supports routes: 'auto'", async () => {
    const config = await load({ routes: "auto" });
    assert.ok(config.routes.includes("/"));
  });

  it("rejects invalid values", async () => {
    await assert.rejects(load({ framework: "angular" }), /Framework must be one of/);
    await assert.rejects(load({ concurrency: Number.NaN }), /Concurrency/);
    await assert.rejects(load({ port: 70000 }), /Port/);
    await assert.rejects(load({ inputDir: "does-not-exist" }), /does not exist/);
  });
});
