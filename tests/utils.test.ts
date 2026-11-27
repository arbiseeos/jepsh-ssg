import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { after, before, describe, it } from "node:test";
import {
  clearCache,
  clearLogs,
  createSpinner,
  errorMessage,
  formatBasePath,
  generateSitemap,
  getMimeType,
  logConfig,
  logError,
  logHeader,
  logInfo,
  logLabel,
  logStamp,
  logSuccess,
  logSummary,
  logWarn,
  readPackageJson,
} from "../src/utils.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { CrawlResult } from "../src/types.js";
import { FIXTURE_DIR, PROJECT_ROOT, captureConsole, cleanup, inDirectory, makeTempDir, waitForContent } from "./helpers.js";

describe("getMimeType", () => {
  it("maps common build artifacts, case-insensitively", () => {
    assert.match(getMimeType("a.html"), /^text\/html/);
    assert.match(getMimeType("a.mjs"), /^text\/javascript/);
    assert.match(getMimeType("a.CSS"), /^text\/css/);
    assert.equal(getMimeType("a.xml"), "application/xml; charset=utf-8");
    assert.equal(getMimeType("a.svg"), "image/svg+xml");
    assert.equal(getMimeType("a.woff2"), "font/woff2");
    assert.equal(getMimeType("a.webp"), "image/webp");
    assert.equal(getMimeType("a.unknown"), "application/octet-stream");
    assert.equal(getMimeType("no-extension"), "application/octet-stream");
  });
});

describe("formatBasePath", () => {
  it("normalizes to '' or '/segment'", () => {
    assert.equal(formatBasePath(undefined), "");
    assert.equal(formatBasePath(""), "");
    assert.equal(formatBasePath("/"), "");
    assert.equal(formatBasePath("app"), "/app");
    assert.equal(formatBasePath("/app/"), "/app");
  });
});

describe("errorMessage", () => {
  it("unwraps Error instances and stringifies anything else", () => {
    assert.equal(errorMessage(new Error("boom")), "boom");
    assert.equal(errorMessage("nope"), "nope");
  });
});

describe("readPackageJson", () => {
  it("finds the package root from the source directory", () => {
    const expected = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8")) as { name: string; version: string };
    const actual = readPackageJson();
    assert.equal(actual.name, expected.name);
    assert.equal(actual.version, expected.version);
  });
});

describe("log formatters", () => {
  it("stamps the current time and labels every level", () => {
    assert.match(logStamp(), /^\[\d{1,2}:\d{2}:\d{2}/);
    assert.match(stripVTControlCharacters(logLabel("info")), /INFO/);
    assert.match(stripVTControlCharacters(logLabel("success")), /SUCCESS/);
    assert.match(stripVTControlCharacters(logLabel("warn")), /WARN/);
    assert.match(stripVTControlCharacters(logLabel("error")), /ERROR/);
  });

  it("creates a spinner", () => {
    const spinner = createSpinner("working");
    spinner.stop();
    assert.match(String(spinner.text), /working/);
  });
});

describe("logging and the debug log file", () => {
  let tmp: string;

  before(() => {
    tmp = makeTempDir();
  });
  after(() => cleanup(tmp));

  it("prints every level and appends to .jepsh/debug/logs/ssg.log", async () => {
    await inDirectory(tmp, async () => {
      const capture = captureConsole();
      try {
        logHeader();
        logInfo("info line");
        logSuccess("success line");
        logWarn("warn line");
        logError("error line");
      } finally {
        capture.restore();
      }

      assert.ok(capture.lines.length >= 5);
      assert.match(stripVTControlCharacters(capture.lines.join("\n")), /info line[\s\S]*success line[\s\S]*warn line[\s\S]*error line/);

      const logPath = path.join(tmp, ".jepsh/debug/logs/ssg.log");
      await waitForContent(logPath, "error line");
      const log = stripVTControlCharacters(fs.readFileSync(logPath, "utf-8"));
      assert.match(log, /Jepsh SSG started/);
      for (const line of ["info line", "success line", "warn line", "error line"]) {
        assert.match(log, new RegExp(line));
      }
    });
  });

  it("keeps working when the log directory cannot be created", async () => {
    const broken = makeTempDir();
    try {
      fs.writeFileSync(path.join(broken, ".jepsh"), "not a directory");
      await inDirectory(broken, async () => {
        const capture = captureConsole();
        try {
          logInfo("still printed");
        } finally {
          capture.restore();
        }

        assert.match(capture.lines.join("\n"), /still printed/);
      });
    } finally {
      cleanup(broken);
    }
  });
});

describe("logConfig", () => {
  it("reports expanded and dynamic route counts", () => {
    const capture = captureConsole();
    try {
      logConfig({
        ...DEFAULT_CONFIG,
        routes: ["/", "/about", { path: "/users/:id", params: { id: ["1", "2"] } }],
      });
    } finally {
      capture.restore();
    }

    const output = stripVTControlCharacters(capture.lines.join("\n"));
    assert.match(output, /Routes\s+: 4 routes \(1 dynamic\)/);
    assert.match(output, /Framework\s+: react/);
  });
});

describe("logSummary", () => {
  const success: CrawlResult = { route: "/", status: "success", filePath: "index.html", fileSize: "1 kB", duration: "0.10" };
  const skipped: CrawlResult = { route: "/about", status: "skipped", filePath: "about/index.html", fileSize: "1 kB", duration: 0 };
  const failed: CrawlResult = { route: "/admin", status: "failed", error: "boom" };

  it("celebrates an all-success run and shows skipped routes", () => {
    const capture = captureConsole();
    try {
      logSummary([success, skipped], 3000);
    } finally {
      capture.restore();
    }

    const output = stripVTControlCharacters(capture.lines.join("\n"));
    assert.match(output, /Successful\s+: 1 route/);
    assert.match(output, /Skipped\s+: 1 route/);
    assert.match(output, /Average\s+: 1\.50s per route/);
    assert.match(output, /All 2 route\(s\) processed successfully/);
  });

  it("warns when a route failed and handles an empty run", () => {
    let capture = captureConsole();
    try {
      logSummary([success, failed], 1000);
    } finally {
      capture.restore();
    }

    assert.match(stripVTControlCharacters(capture.lines.join("\n")), /1 route\(s\) processed successfully, 1 failed/);

    capture = captureConsole();
    try {
      logSummary([], 0);
    } finally {
      capture.restore();
    }

    assert.match(stripVTControlCharacters(capture.lines.join("\n")), /All 0 route\(s\) processed successfully/);
  });
});

describe("generateSitemap", () => {
  const tmp = makeTempDir();

  after(() => cleanup(tmp));

  it("builds absolute, XML-safe URLs and creates the output directory", async () => {
    const outDir = path.join(tmp, "nested", "out");
    const file = await generateSitemap(["/", "/a&b", "/q'uote"], "https://example.com/", outDir, "/app");
    const xml = fs.readFileSync(file, "utf-8");
    assert.equal(file, path.join(outDir, "sitemap.xml"));
    assert.match(xml, /<loc>https:\/\/example\.com\/app\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/example\.com\/app\/a&amp;b<\/loc>/);
    assert.match(xml, /q&apos;uote/);
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  });
});

describe("clearCache and clearLogs", () => {
  it("removes cached data, logs and screenshots, and tolerates missing files", async () => {
    const tmp = makeTempDir();
    try {
      fs.mkdirSync(path.join(tmp, ".jepsh/caches"), { recursive: true });
      fs.writeFileSync(path.join(tmp, ".jepsh/caches/ssg.json"), "{}");
      fs.mkdirSync(path.join(tmp, ".jepsh/debug/logs"), { recursive: true });
      fs.writeFileSync(path.join(tmp, ".jepsh/debug/logs/ssg.log"), "log");
      fs.mkdirSync(path.join(tmp, ".jepsh/debug/screenshots/ssg"), { recursive: true });
      fs.writeFileSync(path.join(tmp, ".jepsh/debug/screenshots/ssg/home.png"), "png");

      await inDirectory(tmp, async () => {
        await clearCache();
        await clearLogs();

        assert.equal(fs.existsSync(path.join(tmp, ".jepsh/caches/ssg.json")), false);
        assert.equal(fs.existsSync(path.join(tmp, ".jepsh/debug/logs/ssg.log")), false);
        assert.equal(fs.existsSync(path.join(tmp, ".jepsh/debug/screenshots/ssg")), false);

        // Running again with nothing to remove must not throw.
        await clearCache();
        await clearLogs();
      });
    } finally {
      cleanup(tmp);
    }
  });
});

describe("fixtures", () => {
  it("keeps the SPA fixture intact", () => {
    assert.equal(fs.existsSync(path.join(FIXTURE_DIR, "index.html")), true);
  });
});
