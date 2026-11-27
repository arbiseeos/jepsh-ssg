import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeRegExp, expandRouteEntry, expandRoutes, extractParamNames, isExcluded, normalizeRoutePath, parseRouteList, splitRouteList } from "../src/routes.js";
import type { RouteEntry } from "../src/types.js";

const paths = (routes: RouteEntry[], options?: { excludeRoutes?: string[]; timeout?: number }): string[] => expandRoutes(routes, options).map((route) => route.path);

describe("splitRouteList", () => {
  it("does not split commas inside [...] groups", () => {
    assert.deepEqual(splitRouteList("/,/about,/users/:id[1,2]"), ["/", "/about", "/users/:id[1,2]"]);
    assert.deepEqual(splitRouteList("/blog/:a[x,y]/:b[1,2],/about"), ["/blog/:a[x,y]/:b[1,2]", "/about"]);
  });

  it("handles nested brackets, stray closing brackets, empty entries and whitespace", () => {
    assert.deepEqual(splitRouteList(" / , ,/a[[b]], "), ["/", "/a[[b]]"]);
    assert.deepEqual(splitRouteList("]]/,/a"), ["]]/", "/a"]);
    assert.deepEqual(splitRouteList(""), []);
  });
});

describe("parseRouteList", () => {
  it("parses a bracketed CLI param group into a value array", () => {
    assert.deepEqual(parseRouteList("/,/about,/users/:id[1,2]"), ["/", "/about", { path: "/users/:id", params: { id: ["1", "2"] } }]);
  });

  it("supports several bracket groups as a cartesian grid", () => {
    assert.deepEqual(parseRouteList("/blog/:category[tech,design]/:slug[a,b]"), [
      {
        path: "/blog/:category/:slug",
        params: { category: ["tech", "design"], slug: ["a", "b"] },
      },
    ]);
  });

  it("trims values, drops empty values and handles groups before the end of the path", () => {
    assert.deepEqual(parseRouteList(" /posts/:slug[a, b, ]/edit "), [{ path: "/posts/:slug/edit", params: { slug: ["a", "b"] } }]);
  });

  it("leaves routes without brackets untouched", () => {
    assert.deepEqual(parseRouteList("/,/about"), ["/", "/about"]);
  });
});

describe("normalizeRoutePath", () => {
  it("adds one leading slash and removes one trailing slash", () => {
    assert.equal(normalizeRoutePath("about"), "/about");
    assert.equal(normalizeRoutePath("/about/"), "/about");
    assert.equal(normalizeRoutePath("a//b"), "/a/b");
    assert.equal(normalizeRoutePath(""), "/");
    assert.equal(normalizeRoutePath("/"), "/");
  });
});

describe("extractParamNames", () => {
  it("returns placeholders in order", () => {
    assert.deepEqual(extractParamNames("/a/:idx/:id/:idx"), ["idx", "id", "idx"]);
    assert.deepEqual(extractParamNames("/about"), []);
  });
});

describe("escapeRegExp", () => {
  it("escapes regex metacharacters", () => {
    assert.equal(escapeRegExp("a.b*c"), "a\\.b\\*c");
  });
});

describe("isExcluded", () => {
  it("treats regex characters in patterns literally", () => {
    assert.equal(isExcluded("/a.b", ["/a.b"]), true);
    assert.equal(isExcluded("/aXb", ["/a.b"]), false);
  });

  it("expands every wildcard and defaults to no exclusions", () => {
    assert.equal(isExcluded("/api/v1/users", ["/api/*/users"]), true);
    assert.equal(isExcluded("/x", []), false);
    assert.equal(isExcluded("/x", undefined), false);
  });
});

describe("expandRouteEntry", () => {
  it("expands complete parameter sets", () => {
    assert.deepEqual(expandRouteEntry({ path: "/users/:id", params: [{ id: 1 }, { id: "admin" }] }), ["/users/1", "/users/admin"]);
  });

  it("does not let :id clobber a longer param name", () => {
    assert.deepEqual(expandRouteEntry({ path: "/a/:idx/:id", params: [{ id: "1", idx: "2" }] }), ["/a/2/1"]);
  });

  it("expands an object of value arrays as a cartesian product in placeholder order", () => {
    assert.deepEqual(expandRouteEntry({ path: "/:lang/p/:slug", params: { lang: ["en", "de"], slug: ["a", "b"] } }), ["/en/p/a", "/en/p/b", "/de/p/a", "/de/p/b"]);
  });

  it("keeps a plain path without placeholders", () => {
    assert.deepEqual(expandRouteEntry("/about"), ["/about"]);
    assert.deepEqual(expandRouteEntry({ path: "/about" }), ["/about"]);
  });

  it("rejects a plain string that contains placeholders", () => {
    assert.throws(() => expandRouteEntry("/users/:id"), /contains the placeholder ':id' but no params were provided/);
  });

  it("rejects an object route with placeholders but no params", () => {
    assert.throws(() => expandRouteEntry({ path: "/users/:id" }), /contains the placeholder ':id' but no params were provided/);
  });

  it("rejects params when the path has no placeholders", () => {
    assert.throws(() => expandRouteEntry({ path: "/about", params: [{ id: "1" }] }), /has no placeholders but params were provided/);
    assert.throws(() => expandRouteEntry({ path: "/about", params: { id: ["1"] } }), /has no placeholders but params were provided/);
  });

  it("requires every placeholder in each parameter set and rejects unknown keys", () => {
    assert.throws(() => expandRouteEntry({ path: "/a/:x/:y", params: [{ x: "1" }] }), /is missing the parameter ':y'/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [{ x: "1", y: "2" }] }), /contains an unknown parameter 'y' \(expected 'x'\)/);
  });

  it("rejects empty, non-object and malformed parameter lists", () => {
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [] }), /has an empty params list/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [null as never] }), /must be an object of parameter values/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [["a"]] as never }), /must be an object of parameter values/);
  });

  it("rejects empty, unknown and missing grid values", () => {
    assert.throws(() => expandRouteEntry({ path: "/a", params: {} }), /has an empty params object/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: {} }), /has an empty params object/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: { x: ["1"], y: ["2"] } }), /has values for 'y', which is not a placeholder/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: { x: [] } }), /needs at least one value for ':x'/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: { x: "1" } as never }), /needs at least one value for ':x'/);
  });

  it("rejects duplicate placeholders and value separators", () => {
    assert.throws(() => expandRouteEntry("/:id/:id"), /uses the parameter ':id' more than once/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [{ x: "a/b" }] }), /must not contain '\/', '\?' or '#'/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [{ x: "a?b" }] }), /must not contain/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [{ x: "a#b" }] }), /must not contain/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [{ x: "" }] }), /has an empty value for ':x'/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [{ x: "   " }] }), /has an empty value for ':x'/);
    assert.throws(() => expandRouteEntry({ path: "/a/:x", params: [{ x: undefined } as never] }), /has no value for ':x'/);
  });

  it("rejects malformed entries", () => {
    assert.throws(() => expandRouteEntry({ nope: true } as unknown as RouteEntry), /Invalid route entry/);
    assert.throws(() => expandRouteEntry(null as unknown as RouteEntry), /Invalid route entry/);
    assert.throws(() => expandRouteEntry({ path: 42 } as unknown as RouteEntry), /Invalid route entry/);
  });
});

describe("expandRoutes", () => {
  it("fills params, normalizes, de-duplicates and applies timeouts", () => {
    assert.deepEqual(expandRoutes([{ path: "/users/:id", params: [{ id: 1 }, { id: 2 }] }], { timeout: 1000 }), [
      { path: "/users/1", timeout: 1000 },
      { path: "/users/2", timeout: 1000 },
    ]);

    assert.deepEqual(expandRoutes(["about", "/about/", { path: "/slow", timeout: 5 }, { path: "/zero", timeout: 0 }], { timeout: 100 }), [
      { path: "/about", timeout: 100 },
      { path: "/slow", timeout: 5 },
      { path: "/zero", timeout: 0 },
    ]);
  });

  it("drops excluded routes, including every wildcard", () => {
    assert.deepEqual(paths(["/", "/api/a/b", "/admin", { path: "/u/:id", params: [{ id: "1" }] }], { excludeRoutes: ["/api/*", "/admin", "/u/*"] }), ["/"]);
  });

  it("expands CLI shorthand with bracket groups", () => {
    const routes = parseRouteList("/blog/:category[tech,design]/:slug[a,b]");
    assert.deepEqual(paths(routes), ["/blog/tech/a", "/blog/tech/b", "/blog/design/a", "/blog/design/b"]);
  });
});
