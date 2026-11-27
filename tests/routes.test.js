import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandRoutes, isExcluded, parseRouteList } from "../src/routes.js";

describe("parseRouteList", () => {
  it("does not split commas inside [...] param lists", () => {
    assert.deepEqual(parseRouteList("/,/about,/users/:id[1,2]"), ["/", "/about", { path: "/users/:id", params: [{ id: "1" }, { id: "2" }] }]);
  });

  it("supports param names other than id and trims whitespace", () => {
    assert.deepEqual(parseRouteList(" /posts/:slug[a, b] "), [{ path: "/posts/:slug", params: [{ slug: "a" }, { slug: "b" }] }]);
  });
});

describe("expandRoutes", () => {
  it("fills :params into the path", () => {
    const routes = expandRoutes([{ path: "/users/:id", params: [{ id: 1 }, { id: 2 }] }], { timeout: 1000 });
    assert.deepEqual(routes, [
      { path: "/users/1", timeout: 1000 },
      { path: "/users/2", timeout: 1000 },
    ]);
  });

  it("does not let :id clobber a longer param name", () => {
    const [route] = expandRoutes([{ path: "/a/:idx/:id", params: [{ id: "1", idx: "2" }] }]);
    assert.equal(route.path, "/a/2/1");
  });

  it("normalizes paths, removes duplicates and honours per-route timeouts", () => {
    const routes = expandRoutes(["about", "/about/", { path: "/slow", timeout: 5 }], { timeout: 100 });
    assert.deepEqual(routes, [
      { path: "/about", timeout: 100 },
      { path: "/slow", timeout: 5 },
    ]);
  });

  it("drops excluded routes, including all wildcards", () => {
    const routes = expandRoutes(["/", "/api/a/b", "/admin"], { excludeRoutes: ["/api/*", "/admin"] });
    assert.deepEqual(
      routes.map((route) => route.path),
      ["/"]
    );
  });

  it("throws on malformed entries", () => {
    assert.throws(() => expandRoutes([{ nope: true }]), /Invalid route entry/);
  });
});

describe("isExcluded", () => {
  it("treats regex characters in patterns literally", () => {
    assert.equal(isExcluded("/a.b", ["/a.b"]), true);
    assert.equal(isExcluded("/aXb", ["/a.b"]), false);
  });
});
