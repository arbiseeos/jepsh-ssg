import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { formatBasePath, generateSitemap, getMimeType } from "../src/utils.js";
import { cleanup, makeTempDir } from "./helpers.js";

describe("getMimeType", () => {
  it("maps common build artifacts", () => {
    assert.match(getMimeType("a.html"), /^text\/html/);
    assert.match(getMimeType("a.mjs"), /^text\/javascript/);
    assert.equal(getMimeType("a.webp"), "image/webp");
    assert.equal(getMimeType("a.unknown"), "application/octet-stream");
  });
});

describe("formatBasePath", () => {
  it("normalizes to '' or '/segment'", () => {
    assert.equal(formatBasePath(""), "");
    assert.equal(formatBasePath("/"), "");
    assert.equal(formatBasePath("app"), "/app");
    assert.equal(formatBasePath("/app/"), "/app");
  });
});

describe("generateSitemap", () => {
  const tmp = makeTempDir();

  after(() => cleanup(tmp));
  it("builds absolute, XML-safe URLs", async () => {
    const file = await generateSitemap(["/", "/a&b"], "https://example.com/", tmp, "/app");
    const xml = fs.readFileSync(file, "utf-8");
    assert.equal(file, path.join(tmp, "sitemap.xml"));
    assert.match(xml, /<loc>https:\/\/example\.com\/app\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/example\.com\/app\/a&amp;b<\/loc>/);
  });
});
