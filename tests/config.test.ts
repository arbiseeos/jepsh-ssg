import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  DEFAULT_CONFIG,
  autoDetectRoutes,
  loadConfig,
  normalizePromptAnswers,
  promptConfig,
  promptQuestions,
  readUserConfig,
  saveConfig,
  validateConfig,
  type PromptAnswers,
  type PromptQuestion,
} from "../src/config.js";
import type { Framework, SsgConfig } from "../src/types.js";
import { captureConsole, cleanup, copyFixture, inDirectory, makeTempDir } from "./helpers.js";

describe("loadConfig", () => {
  let cwd: string;
  let dist: string;

  before(() => {
    cwd = makeTempDir();
    dist = copyFixture(cwd);
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "host", type: "module" }));
  });
  after(() => cleanup(cwd));

  const load = (overrides = {}, extra = {}) => loadConfig({ cwd, interactive: false, overrides: { inputDir: "dist", ...overrides }, ...extra });

  it("applies defaults when no config file exists and flags were given", async () => {
    const config = await load({ framework: "vite" });
    assert.deepEqual(config.routes, ["/"]);
    assert.equal(config.framework, "vite");
    assert.equal(config.port, 3000);
    assert.equal(config.hydrateBundle, null);
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

  it("reads jepsh.config.mjs and jepsh.config.cjs", async () => {
    const mjs = path.join(cwd, "jepsh.config.mjs");
    fs.writeFileSync(mjs, `export default { ssg: { routes: ["/mjs"], inputDir: "dist" } };\n`);
    try {
      assert.deepEqual((await load()).routes, ["/mjs"]);
    } finally {
      fs.rmSync(mjs);
    }

    const cjs = path.join(cwd, "jepsh.config.cjs");
    fs.writeFileSync(cjs, `module.exports = { ssg: { routes: ["/cjs"], inputDir: "dist" } };\n`);
    try {
      assert.deepEqual((await load()).routes, ["/cjs"]);
    } finally {
      fs.rmSync(cjs);
    }
  });

  it("reads package.json#jepsh.ssg and lets it override an exported config", async () => {
    // A fresh directory: Node caches imported config modules by path.
    const fresh = makeTempDir();
    try {
      const freshDist = copyFixture(fresh);
      fs.writeFileSync(path.join(fresh, "jepsh.config.js"), `export default { ssg: { routes: ["/file"], concurrency: 4 } };\n`);
      fs.writeFileSync(path.join(fresh, "package.json"), JSON.stringify({ name: "host", type: "module", jepsh: { ssg: { routes: ["/package"], inputDir: "dist" } } }));

      const config = await loadConfig({ cwd: fresh, interactive: false, overrides: { inputDir: freshDist } });
      assert.deepEqual(config.routes, ["/package"]);
      assert.equal(config.concurrency, 4);
    } finally {
      cleanup(fresh);
    }
  });

  it("supports routes: 'auto'", async () => {
    const config = await load({ routes: "auto" });
    assert.ok(config.routes.includes("/"));
    assert.deepEqual(
      config.routes.filter((route) => typeof route !== "string" || !route.startsWith("/")),
      []
    );
  });

  it("parses a route string override", async () => {
    const config = await load({ routes: "/,/blog/:slug[a,b]" });
    assert.deepEqual(config.routes, ["/", { path: "/blog/:slug", params: { slug: ["a", "b"] } }]);
  });

  it("validates route configuration before a build starts", async () => {
    await assert.rejects(load({ routes: [{ path: "/users/:id" }] }), /contains the placeholder ':id' but no params were provided/);
    await assert.rejects(load({ routes: [] }), /Routes must be a non-empty array/);
  });

  it("rejects invalid values", async () => {
    await assert.rejects(load({ framework: "angular" }), /Framework must be one of/);
    await assert.rejects(load({ concurrency: Number.NaN }), /Concurrency/);
    await assert.rejects(load({ port: 70000 }), /Port/);
    await assert.rejects(load({ inputDir: "does-not-exist" }), /does not exist/);
    await assert.rejects(load({ baseUrl: "not a url" }), /Invalid baseUrl/);
  });

  it("never prompts when the caller disables interactive mode", async () => {
    const empty = makeTempDir();
    try {
      fs.writeFileSync(path.join(empty, "package.json"), JSON.stringify({ name: "host" }));
      const config = await loadConfig({ cwd: empty, interactive: false, overrides: { inputDir: dist, routes: ["/"] } });
      assert.deepEqual(config.routes, ["/"]);
      assert.equal(fs.existsSync(path.join(empty, "jepsh.config.js")), false);
    } finally {
      cleanup(empty);
    }
  });

  it("does not prompt when routes were supplied on the command line", async () => {
    const fresh = makeTempDir();
    try {
      const freshDist = copyFixture(fresh);
      fs.writeFileSync(path.join(fresh, "package.json"), JSON.stringify({ name: "host", type: "module" }));
      const config = await loadConfig({ cwd: fresh, interactive: true, overrides: { routes: ["/"], inputDir: freshDist } });
      assert.deepEqual(config.routes, ["/"]);
      assert.equal(fs.existsSync(path.join(fresh, "jepsh.config.js")), false);
    } finally {
      cleanup(fresh);
    }
  });
});

describe("autoDetectRoutes", () => {
  it("walks nested directories and finds index.html and flat .html files", () => {
    const tmp = makeTempDir();
    try {
      const dist = copyFixture(tmp);
      fs.mkdirSync(path.join(dist, "about"), { recursive: true });
      fs.writeFileSync(path.join(dist, "about/index.html"), "<html></html>");
      fs.writeFileSync(path.join(dist, "contact.html"), "<html></html>");
      fs.mkdirSync(path.join(dist, "docs/guide"), { recursive: true });
      fs.writeFileSync(path.join(dist, "docs/guide/index.html"), "<html></html>");

      const routes = autoDetectRoutes(dist).sort();
      assert.deepEqual(routes, ["/", "/about", "/contact", "/docs/guide"]);
    } finally {
      cleanup(tmp);
    }
  });

  it("returns just '/' for a missing directory", () => {
    assert.deepEqual(autoDetectRoutes(path.join(makeTempDir(), "nope")), ["/"]);
  });
});

describe("readUserConfig", () => {
  it("reports when nothing was found", async () => {
    const tmp = makeTempDir();
    try {
      assert.deepEqual(await readUserConfig(tmp), { config: {}, found: false });
    } finally {
      cleanup(tmp);
    }
  });

  it("reads both a config file and package.json", async () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(path.join(tmp, "jepsh.config.js"), `export default { ssg: { routes: ["/a"] } };\n`);
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ jepsh: { ssg: { concurrency: 9 } } }));
      assert.deepEqual(await readUserConfig(tmp), { config: { routes: ["/a"], concurrency: 9 }, found: true });
    } finally {
      cleanup(tmp);
    }
  });
});

describe("saveConfig", () => {
  it("writes ESM syntax for module projects and logs the path", async () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ type: "module" }));
      const capture = captureConsole();
      try {
        await saveConfig({ routes: ["/"], inputDir: "dist" }, tmp);
      } finally {
        capture.restore();
      }

      const saved = fs.readFileSync(path.join(tmp, "jepsh.config.js"), "utf-8");
      assert.match(saved, /^export default \{/);
      assert.match(saved, /"inputDir": "dist"/);
      assert.match(capture.lines.join("\n"), /Saved configuration/);
    } finally {
      cleanup(tmp);
    }
  });

  it("writes CommonJS syntax for other projects and does not overwrite an existing file", async () => {
    const tmp = makeTempDir();
    try {
      await saveConfig({ routes: ["/"] }, tmp);
      assert.match(fs.readFileSync(path.join(tmp, "jepsh.config.js"), "utf-8"), /^module\.exports = \{/);

      fs.writeFileSync(path.join(tmp, "jepsh.config.js"), "// keep me\n");
      await saveConfig({ routes: ["/other"] }, tmp);
      assert.equal(fs.readFileSync(path.join(tmp, "jepsh.config.js"), "utf-8"), "// keep me\n");
    } finally {
      cleanup(tmp);
    }
  });

  it("falls back to CommonJS when package.json is unreadable", async () => {
    const tmp = makeTempDir();
    try {
      fs.writeFileSync(path.join(tmp, "package.json"), "{ not json");
      await saveConfig({ routes: ["/"] }, tmp);
      assert.match(fs.readFileSync(path.join(tmp, "jepsh.config.js"), "utf-8"), /^module\.exports = \{/);
    } finally {
      cleanup(tmp);
    }
  });
});

describe("normalizePromptAnswers", () => {
  const answers: PromptAnswers = {
    routes: " /,/users/:id[1,2] ",
    basePath: "/app",
    baseUrl: "https://example.com",
    inputDir: "dist",
    outDir: "out",
    port: "4000",
    concurrency: "2",
    flatOutput: true,
    hydrate: true,
    hydrateBundle: "assets/app.js",
    framework: "svelte",
    batchSize: "10",
    incremental: true,
    timeout: "5000",
    inlineCss: true,
    sitemap: true,
    excludeRoutes: "/api/*, /admin",
    customSelectors: "#app > *, main",
  };

  it("converts answers into a typed config", () => {
    const config = normalizePromptAnswers(answers);
    assert.deepEqual(config.routes, ["/", { path: "/users/:id", params: { id: ["1", "2"] } }]);
    assert.equal(config.port, 4000);
    assert.equal(config.concurrency, 2);
    assert.equal(config.batchSize, 10);
    assert.equal(config.timeout, 5000);
    assert.equal(config.hydrateBundle, "assets/app.js");
    assert.deepEqual(config.excludeRoutes, ["/api/*", "/admin"]);
    assert.deepEqual(config.customSelectors, ["#app > *", "main"]);
    assert.equal(config.framework, "svelte");
  });

  it("supports 'auto' routes, blank lists and an absent hydration bundle", () => {
    const config = normalizePromptAnswers({ ...answers, routes: " auto ", hydrateBundle: "", excludeRoutes: "", customSelectors: "" });
    assert.equal(config.routes, "auto");
    assert.equal(config.hydrateBundle, null);
    assert.deepEqual(config.excludeRoutes, []);
    assert.deepEqual(config.customSelectors, []);
  });
});

describe("promptConfig", () => {
  const questions = (): PromptQuestion[] => promptQuestions();
  const question = (name: string): PromptQuestion => {
    const found = questions().find((item) => item.name === name);
    assert.ok(found, `missing question ${name}`);

    return found;
  };

  it("asks every question and validates answers", () => {
    assert.equal(questions().length, 18);
    assert.deepEqual(question("framework").choices, ["react", "vite", "vue", "svelte"]);

    const routes = question("routes").validate as (input: string) => true | string;
    assert.equal(routes(""), "At least one route is required");
    assert.equal(routes("/"), true);

    const baseUrl = question("baseUrl").validate as (input: string) => true | string;
    assert.equal(baseUrl("nope"), "Invalid URL format");
    assert.equal(baseUrl("https://example.com"), true);

    const port = question("port").validate as (input: string) => true | string;
    assert.equal(port("0"), "Port must be a number between 1 and 65535");
    assert.equal(port("3000"), true);

    const concurrency = question("concurrency").validate as (input: string) => true | string;
    assert.equal(concurrency("0"), "Concurrency must be a positive number");
    assert.equal(concurrency("3"), true);

    const batchSize = question("batchSize").validate as (input: string) => true | string;
    assert.equal(batchSize("0"), "Batch size must be a positive number");

    const timeout = question("timeout").validate as (input: string) => true | string;
    assert.equal(timeout("0"), "Timeout must be a positive number");

    const when = question("hydrateBundle").when as (current: { hydrate?: boolean }) => boolean;
    assert.equal(when({ hydrate: true }), true);
    assert.equal(when({}), false);

    const inputDir = question("inputDir").validate as (input: string) => true | string;
    const tmp = makeTempDir();
    try {
      assert.match(String(inputDir(path.join(tmp, "missing"))), /does not exist/);
      assert.match(String(inputDir(tmp)), /No index.html found/);
      const dist = copyFixture(tmp);
      assert.equal(inputDir(dist), true);
    } finally {
      cleanup(tmp);
    }
  });

  it("normalizes the wizard answers", async () => {
    const config = await promptConfig(async (asked) => {
      assert.equal(asked.length, 18);

      return {
        routes: "/,/about",
        basePath: "",
        baseUrl: "https://example.com",
        inputDir: "dist",
        outDir: "out",
        port: 3000,
        concurrency: "4",
        flatOutput: false,
        hydrate: false,
        hydrateBundle: "",
        framework: "react",
        batchSize: 50,
        incremental: false,
        timeout: 30000,
        inlineCss: false,
        sitemap: false,
        excludeRoutes: "",
        customSelectors: "",
      };
    });

    assert.deepEqual(config.routes, ["/", "/about"]);
    assert.equal(config.concurrency, 4);
    assert.equal(config.hydrateBundle, null);
  });
});

describe("validateConfig", () => {
  let cwd: string;
  let dist: string;
  let base: SsgConfig;

  before(() => {
    cwd = makeTempDir();
    dist = copyFixture(cwd);
    base = { ...DEFAULT_CONFIG, inputDir: dist, routes: ["/"] };
  });
  after(() => cleanup(cwd));

  const invalid = (patch: Record<string, unknown>): SsgConfig => ({ ...base, ...patch }) as SsgConfig;

  it("accepts the defaults", () => {
    assert.doesNotThrow(() => validateConfig(base, cwd));
  });

  it("rejects every invalid field", () => {
    assert.throws(() => validateConfig(invalid({ routes: [] }), cwd), /Routes must be a non-empty array/);
    assert.throws(() => validateConfig(invalid({ baseUrl: "nope" }), cwd), /Invalid baseUrl/);
    assert.throws(() => validateConfig(invalid({ inputDir: "" }), cwd), /Input directory/);
    assert.throws(() => validateConfig(invalid({ inputDir: "missing" }), cwd), /does not exist/);

    const noIndex = makeTempDir();
    try {
      assert.throws(() => validateConfig(invalid({ inputDir: noIndex }), cwd), /No index.html found/);
    } finally {
      cleanup(noIndex);
    }

    assert.throws(() => validateConfig(invalid({ port: -1 }), cwd), /Port/);
    assert.throws(() => validateConfig(invalid({ port: 70000 }), cwd), /Port/);
    assert.throws(() => validateConfig(invalid({ port: 1.5 }), cwd), /Port/);
    assert.throws(() => validateConfig(invalid({ concurrency: 0 }), cwd), /Concurrency/);
    assert.throws(() => validateConfig(invalid({ hydrateBundle: 5 }), cwd), /hydrateBundle/);
    assert.throws(() => validateConfig(invalid({ framework: "angular" as Framework }), cwd), /Framework must be one of/);
    assert.throws(() => validateConfig(invalid({ batchSize: 0 }), cwd), /Batch size/);
    assert.throws(() => validateConfig(invalid({ timeout: 0 }), cwd), /Timeout/);
    assert.throws(() => validateConfig(invalid({ excludeRoutes: "x" }), cwd), /excludeRoutes/);
    assert.throws(() => validateConfig(invalid({ customSelectors: "x" }), cwd), /customSelectors/);
    assert.throws(() => validateConfig(invalid({ browserArgs: "x" }), cwd), /browserArgs/);
  });

  it("accepts absolute input directories", () => {
    assert.doesNotThrow(() => validateConfig(invalid({ inputDir: dist }), cwd));
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has the documented defaults", () => {
    assert.deepEqual(DEFAULT_CONFIG.routes, ["/"]);
    assert.equal(DEFAULT_CONFIG.inputDir, "build");
    assert.equal(DEFAULT_CONFIG.outDir, "build-ssg");
    assert.equal(DEFAULT_CONFIG.port, 3000);
    assert.equal(DEFAULT_CONFIG.concurrency, 3);
    assert.equal(DEFAULT_CONFIG.timeout, 30000);
    assert.equal(DEFAULT_CONFIG.batchSize, 50);
    assert.equal(DEFAULT_CONFIG.framework, "react");
  });
});

describe("loadConfig in a working directory", () => {
  it("resolves relative input directories against the project cwd", async () => {
    const tmp = makeTempDir();
    try {
      copyFixture(tmp);
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ type: "module" }));
      const config = await inDirectory(tmp, () => loadConfig({ overrides: { inputDir: "dist", routes: ["/"] }, interactive: false }));
      assert.equal(config.inputDir, "dist");
    } finally {
      cleanup(tmp);
    }
  });
});
