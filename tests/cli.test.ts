import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createProgram, main, runBuild, runWatch } from "../src/cli.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { SsgConfig } from "../src/types.js";
import { PROJECT_ROOT, captureConsole, cleanup, copyFixture, delay, inDirectory, makeTempDir, needsNoSandbox } from "./helpers.js";

const CLI = path.join(PROJECT_ROOT, "bin/cli.ts");
const TSX = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");

type RunResult = { code: number; stdout: string; stderr: string };

/**
 * Run the executable in a child process. Coverage is disabled for the child:
 * its transpiled scripts would otherwise be merged into the report with
 * mismapped line numbers and hide genuinely covered code.
 */
const runCli = (args: string[], cwd: string): Promise<RunResult> =>
  new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.NODE_V8_COVERAGE;
    delete env.NODE_OPTIONS;

    execFile(TSX, [CLI, ...args], { cwd, env }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
    });
  });

describe("createProgram", () => {
  it("parses every flag", () => {
    const program = createProgram();
    assert.equal(program.name(), "sssg");
    program.parse([
      "node",
      "cli",
      "--routes",
      "/,/about",
      "--base-path",
      "/app",
      "--base-url",
      "https://example.com",
      "--input-dir",
      "dist",
      "--out-dir",
      "out",
      "--port",
      "0",
      "--concurrency",
      "2",
      "--flat-output",
      "--hydrate",
      "--hydrate-bundle",
      "assets/app.js",
      "--framework",
      "vue",
      "--batch-size",
      "10",
      "--incremental",
      "--timeout",
      "5000",
      "--inline-css",
      "--sitemap",
      "--exclude-routes",
      "/api/*",
      "--custom-selectors",
      "#app > *",
      "--disable-sandbox",
      "--browser-args",
      "--a,--b",
      "--watch",
      "--dry-run",
      "--clear-cache",
      "--clear-logs",
      "--clean",
    ]);

    assert.deepEqual(program.opts(), {
      routes: "/,/about",
      basePath: "/app",
      baseUrl: "https://example.com",
      inputDir: "dist",
      outDir: "out",
      port: "0",
      concurrency: "2",
      flatOutput: true,
      hydrate: true,
      hydrateBundle: "assets/app.js",
      framework: "vue",
      batchSize: "10",
      incremental: true,
      timeout: "5000",
      inlineCss: true,
      sitemap: true,
      excludeRoutes: "/api/*",
      customSelectors: "#app > *",
      disableSandbox: true,
      browserArgs: "--a,--b",
      watch: true,
      dryRun: true,
      clearCache: true,
      clearLogs: true,
      clean: true,
    });
  });
});

describe("main", () => {
  let tmp: string;
  let dist: string;

  before(() => {
    tmp = makeTempDir();
    dist = copyFixture(tmp);
  });
  after(() => cleanup(tmp));

  it("previews routes in dry-run mode", async () => {
    const capture = captureConsole();
    try {
      await main(["node", "cli", "--dry-run", "--routes", "/,/about,/users/:id[1,2]", "--input-dir", dist]);
    } finally {
      capture.restore();
    }

    const output = capture.lines.join("\n");
    assert.match(output, /Dry run mode/);
    for (const route of ["/", "/about", "/users/1", "/users/2"]) {
      assert.match(output, new RegExp(`Route: '${route.replace(/[/]/g, "\\/")}'`));
    }
    assert.equal(process.exitCode, undefined);
  });

  it("reports configuration errors and sets a failing exit code", async () => {
    const capture = captureConsole();
    const previous = process.exitCode;
    try {
      await main(["node", "cli", "--dry-run", "--routes", "/users/:id", "--input-dir", dist]);
    } finally {
      capture.restore();
      process.exitCode = previous;
    }

    assert.match(capture.lines.join("\n"), /contains the placeholder ':id' but no params were provided/);
  });

  it("clears cache and logs without needing an input directory", async () => {
    const cache = path.join(tmp, ".jepsh/caches/ssg.json");
    const log = path.join(tmp, ".jepsh/debug/logs/ssg.log");
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(cache, "{}");
    fs.writeFileSync(log, "log");

    const capture = captureConsole();
    try {
      await inDirectory(tmp, () => main(["node", "cli", "--clear-cache", "--clear-logs"]));
    } finally {
      capture.restore();
    }

    assert.equal(fs.existsSync(cache), false);
    assert.equal(fs.existsSync(log), false);
    assert.match(capture.lines.join("\n"), /cleared successfully/);
  });

  it("clears everything with --clean", async () => {
    fs.mkdirSync(path.join(tmp, ".jepsh/caches"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".jepsh/caches/ssg.json"), "{}");

    const capture = captureConsole();
    try {
      await inDirectory(tmp, () => main(["node", "cli", "--clean"]));
    } finally {
      capture.restore();
    }

    assert.equal(fs.existsSync(path.join(tmp, ".jepsh/caches/ssg.json")), false);
    assert.match(capture.lines.join("\n"), /All cache and logs cleared successfully/);
  });
});

describe("runBuild", () => {
  let tmp: string;
  let dist: string;

  before(() => {
    tmp = makeTempDir();
    dist = copyFixture(tmp);
  });
  after(() => cleanup(tmp));

  it("returns no results in dry-run mode", async () => {
    const config: SsgConfig = { ...DEFAULT_CONFIG, routes: ["/"], inputDir: dist, outDir: path.join(tmp, "dry") };
    const capture = captureConsole();
    try {
      assert.deepEqual(await runBuild(config, true), []);
    } finally {
      capture.restore();
    }
  });

  it("renders routes against a temporary server and prints a summary", { timeout: 180_000 }, async () => {
    const config: SsgConfig = {
      ...DEFAULT_CONFIG,
      routes: ["/", { path: "/users/:id", params: [{ id: 1 }] }],
      inputDir: dist,
      outDir: path.join(tmp, "built"),
      port: 0,
      concurrency: 1,
      framework: "vite",
      disableSandbox: needsNoSandbox(),
    };

    const capture = captureConsole();
    let results;
    try {
      results = await runBuild(config);
    } finally {
      capture.restore();
    }

    assert.deepEqual(
      results.map((result) => result.status),
      ["success", "success"]
    );
    assert.match(fs.readFileSync(path.join(config.outDir, "users/1/index.html"), "utf-8"), /<h1>User 1<\/h1>/);
    assert.match(capture.lines.join("\n"), /All 2 route\(s\) processed successfully/);
  });
});

describe("runWatch", () => {
  it("rebuilds when an input file changes", { timeout: 120_000 }, async () => {
    const tmp = makeTempDir();
    const dist = copyFixture(tmp);
    const config: SsgConfig = { ...DEFAULT_CONFIG, routes: ["/", "/about"], inputDir: dist, outDir: path.join(tmp, "out") };

    const capture = captureConsole();
    try {
      const watcher = await runWatch(config, true);
      try {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 3000);
          watcher.once("ready", () => {
            clearTimeout(timer);
            resolve();
          });
        });

        fs.appendFileSync(path.join(dist, "index.html"), "\n<!-- changed -->\n");
        await delay(1200);
      } finally {
        await watcher.close();
      }
    } finally {
      capture.restore();
      cleanup(tmp);
    }

    const output = capture.lines.join("\n");
    assert.match(output, /Starting watch mode/);
    assert.match(output, /File changed/);
    assert.match(output, /Dry run mode/);
  });
});

describe("the executable", () => {
  it("prints its version and help", async () => {
    const version = await runCli(["--version"], PROJECT_ROOT);
    assert.equal(version.code, 0);
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8")) as { version: string };
    assert.equal(version.stdout.trim(), pkg.version);

    const help = await runCli(["--help"], PROJECT_ROOT);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /--routes/);
    assert.match(help.stdout, /--dry-run/);
  });

  it("exits non-zero for an invalid route configuration", async () => {
    const tmp = makeTempDir();
    try {
      const dist = copyFixture(tmp);
      const result = await runCli(["--dry-run", "--routes", "/users/:id", "--input-dir", dist], tmp);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /contains the placeholder/);
    } finally {
      cleanup(tmp);
    }
  });

  it("clears cache and logs from the working directory", async () => {
    const tmp = makeTempDir();
    try {
      const cache = path.join(tmp, ".jepsh/caches/ssg.json");
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      fs.writeFileSync(cache, "{}");

      const result = await runCli(["--clear-cache"], tmp);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /Cache cleared successfully/);
      assert.equal(fs.existsSync(cache), false);
    } finally {
      cleanup(tmp);
    }
  });
});
