import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { findBundle, injectHydrationScript } from "../src/crawler.js";
import { cleanup, copyFixture, makeTempDir } from "./helpers.js";

describe("injectHydrationScript", () => {
  it("does not add a second copy of a bundle the page already loads", () => {
    const html = '<html><body><div id="root"></div><script type="module" crossorigin src="/assets/app.js"></script></body></html>';
    const result = injectHydrationScript(html, "assets/app.js");
    assert.equal(result.injected, false);
    assert.equal(result.html, html);
  });

  it("injects an ES module script before </body> when missing", () => {
    const result = injectHydrationScript("<html><body><p>hi</p></body></html>", "assets/app.js", "/app");
    assert.equal(result.injected, true);
    assert.equal(result.html, '<html><body><p>hi</p><script type="module" src="/app/assets/app.js"></script></body></html>');
  });

  it("detects the bundle when the base path is part of the URL", () => {
    const html = '<body><script type="module" src="/app/assets/app.js"></script></body>';
    assert.equal(injectHydrationScript(html, "assets/app.js", "/app").injected, false);
  });
});

describe("findBundle", () => {
  let tmp;
  let dist;
  before(() => {
    tmp = makeTempDir();
    dist = copyFixture(tmp);
  });
  after(() => cleanup(tmp));

  it("finds the entry script referenced by index.html", () => {
    assert.equal(findBundle(dist), "assets/app.js");
  });
});
