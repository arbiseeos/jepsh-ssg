# Changelog

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
