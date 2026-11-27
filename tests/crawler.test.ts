import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { findBundle, injectHydrationScript } from "../src/crawler.js";
import { cleanup, copyFixture, makeTempDir } from "./helpers.js";

describe("injectHydrationScript", () => {
  it("does not add a second copy of a bundle the page already loads", () => {
    const html = '<html><body><div id="root"></div><script type="module" crossorigin src="/assets/app.js"></script></body></html>';
    const result = injectHydrationScript(html, "assets/app.js");
    assert.equal(result.injected, false);
    assert.equal(result.html, html);
    assert.equal(result.scriptUrl, "/assets/app.js");
  });

  it("injects an ES module script before </body> when missing", () => {
    const result = injectHydrationScript("<html><body><p>hi</p></body></html>", "assets/app.js", "/app");
    assert.equal(result.injected, true);
    assert.equal(result.html, '<html><body><p>hi</p><script type="module" src="/app/assets/app.js"></script></body></html>');
  });

  it("appends the script when there is no closing body tag", () => {
    const result = injectHydrationScript("<p>hi</p>", "assets/app.js");
    assert.equal(result.html, '<p>hi</p><script type="module" src="/assets/app.js"></script>');
  });

  it("detects the bundle when the base path is part of the URL", () => {
    const html = '<body><script type="module" src="/app/assets/app.js"></script></body>';
    assert.equal(injectHydrationScript(html, "assets/app.js", "/app").injected, false);
  });

  it("normalizes backslashes and duplicate slashes in the bundle path", () => {
    const result = injectHydrationScript("<body></body>", "assets\\app.js", "/app/");
    assert.equal(result.scriptUrl, "/app/assets/app.js");
  });
});

describe("findBundle", () => {
  let tmp: string;
  let dist: string;

  before(() => {
    tmp = makeTempDir();
    dist = copyFixture(tmp);
  });
  after(() => cleanup(tmp));

  it("finds the entry script referenced by index.html", () => {
    assert.equal(findBundle(dist), "assets/app.js");
  });

  it("strips a configured base path from the script URL", () => {
    assert.equal(findBundle(dist, "/app"), "assets/app.js");
  });

  it("resolves ./ prefixed script URLs", () => {
    const dir = makeTempDir();
    try {
      fs.mkdirSync(path.join(dir, "assets"));
      fs.writeFileSync(path.join(dir, "assets/app.js"), "console.log(1)");
      fs.writeFileSync(path.join(dir, "index.html"), '<script src="./assets/app.js"></script>');
      assert.equal(findBundle(dir), "assets/app.js");
    } finally {
      cleanup(dir);
    }
  });

  it("ignores CDN scripts and falls back to a local .js file", () => {
    const dir = makeTempDir();
    try {
      fs.mkdirSync(path.join(dir, "assets"));
      fs.writeFileSync(path.join(dir, "assets/real.js"), "console.log(1)");
      fs.writeFileSync(path.join(dir, "index.html"), '<script src="https://cdn.example.com/lib.js"></script>');
      assert.equal(findBundle(dir), "assets/real.js");
    } finally {
      cleanup(dir);
    }
  });

  it("skips chunk and vendor bundles when scanning the directory", () => {
    const dir = makeTempDir();
    try {
      fs.mkdirSync(path.join(dir, "assets"));
      fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
      fs.writeFileSync(path.join(dir, "assets/chunk-a.js"), "console.log(1)");
      fs.writeFileSync(path.join(dir, "assets/vendor.js"), "console.log(1)");
      fs.writeFileSync(path.join(dir, "assets/main.js"), "console.log(1)");
      assert.equal(findBundle(dir), "assets/main.js");
    } finally {
      cleanup(dir);
    }
  });

  it("returns null when no bundle exists", () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
      assert.equal(findBundle(dir), null);
    } finally {
      cleanup(dir);
    }
  });

  it("scans the directory when index.html is missing", () => {
    const dir = makeTempDir();
    try {
      fs.mkdirSync(path.join(dir, "assets"));
      fs.writeFileSync(path.join(dir, "assets/app.js"), "console.log(1)");
      assert.equal(findBundle(dir), "assets/app.js");
    } finally {
      cleanup(dir);
    }
  });
});
