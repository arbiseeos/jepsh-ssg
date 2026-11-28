# Changelog

## 3.0.1

### Patch Changes

- 34d88d8: Use `domcontentloaded` for Puppeteer navigation so background network activity does not block route rendering. The crawler's framework content checks remain responsible for determining when the page is ready to capture.

## 3.0.0

### Major Changes

- 87aabd0: Rewrite the project in TypeScript and publish it to GitHub Packages.

  - The package is now scoped as `@arbiseeos/jepsh-ssg`. The `jepsh-ssg` binary name is unchanged.
  - GitHub Packages requires consumers to authenticate: add `@arbiseeos:registry=https://npm.pkg.github.com` to `.npmrc` and a token with `read:packages`.
  - Dynamic routes are validated. Every `:placeholder` must be provided by `params`, and unknown parameters, empty values and values containing `/`, `?` or `#` are rejected instead of silently crawling a literal URL.
  - `params` accepts an array of complete parameter sets or an object of value arrays (`{ id: ["1", "2"] }`), which is expanded as the cartesian product. CLI shorthand supports several bracket groups (`/blog/:category[tech,design]/:slug[a,b]`).
  - The published entry point is `dist/src/index.js`; type definitions ship with the package.
  - Releases are managed with Changesets.

### Minor Changes

- e5a7c33: Add route groups to the configuration: `{ params, paths }` shares one set of parameter value domains across several routes, so localized trees no longer repeat `params` on every entry. Group parameters are scoped to the group, every path expands only the placeholders it contains, and an optional `timeout` applies to the whole group. Groups work identically in `jepsh.config.*` and `package.json#jepsh.ssg`.

### Patch Changes

- d02348a: Queue debug log writes so lines are appended to `.jepsh/debug/logs/ssg.log` in call order instead of racing.

## 2.0.0

### Breaking changes

- **Requires Node.js 22 or newer.** Node 20 is end-of-life and Puppeteer 25 needs Node 22+.
- **Puppeteer 25.** Chrome is launched with `headless: true`, and with its sandbox enabled. `--no-sandbox`, `--disable-setuid-sandbox` and `--disable-web-security` are no longer passed by default. Use `--disable-sandbox` (config: `disableSandbox`) where Chrome cannot sandbox, for example when running as root in a container, and `--browser-args` (config: `browserArgs`) for anything else.
- **`critters` replaced by `beasties`**, its maintained fork. `inlineCss` behaves the same.
- **Programmatic API:** `startServer()` now resolves to `{ port, close }` (was a bare close function) and always binds to `127.0.0.1`. `loadConfig()` takes an options object (`{ cwd, overrides, interactive }`).
- The process now exits with a non-zero code when any route fails to render.

### Fixed

- Dynamic routes such as `/users/:id[1,2]` were split on the comma inside the brackets and never had their `:id` filled in, so every param crawled the same URL.
- Passing any CLI flag skipped `jepsh.config.js` and all defaults, so commands like `--framework vite --input-dir dist --sitemap` crashed. CLI flags now override the config file and defaults.
- `--hydrate` loaded the app bundle twice (the saved HTML already contained it) and as a classic script, which fails for ES module bundles from Vite. It is now added only when missing, as `type="module"`.
- Two routes could be rendered on the same browser page at the same time when `concurrency` was above 1, producing intermittently wrong HTML. Each route now gets its own page.
- Incremental builds: a failed route was recorded as done, and routes that were skipped lost their rendered output when the input directory was copied over. Cache entries are written only for successful routes, skipped output is preserved, and the cache is invalidated when build options change.
- The static server could serve files outside `inputDir` for `..` paths, did not URL-decode paths, listened on all interfaces, and never reported listen errors such as a busy port.
- `routes: "auto"` in a config file was rejected.
- `excludeRoutes` only expanded the first `*`, and the sitemap ignored `excludeRoutes`. Sitemap URLs are now XML-escaped.
- A new file handle was opened for every log line.
- The browser was left running if a build threw.
- A first-run prompt could overwrite settings from `package.json`. It now runs only when no configuration exists, and writes a config file that matches your project's module type.

### Removed

- The `crypto` dependency (a deprecated placeholder; Node's built-in `crypto` is used), `fs-extra`, and the unused Babel, mocha, chai and sinon dev dependencies.

### Tooling

- ESLint 10 with a flat config (replacing ESLint 8 and the unmaintained `eslint-plugin-node`).
- Tests use Node's built-in test runner, including an end-to-end crawl in headless Chrome against a Vite-style fixture.
- CI on Node 22, 24 and 26. The publish workflow runs the same checks and publishes with npm provenance.
