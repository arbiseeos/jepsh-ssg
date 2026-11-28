---
"@arbiseeos/jepsh-ssg": major
---

Rewrite the project in TypeScript and publish it to GitHub Packages.

- The package is now scoped as `@arbiseeos/jepsh-ssg`. The `jepsh-ssg` binary name is unchanged.
- GitHub Packages requires consumers to authenticate: add `@arbiseeos:registry=https://npm.pkg.github.com` to `.npmrc` and a token with `read:packages`.
- Dynamic routes are validated. Every `:placeholder` must be provided by `params`, and unknown parameters, empty values and values containing `/`, `?` or `#` are rejected instead of silently crawling a literal URL.
- `params` accepts an array of complete parameter sets or an object of value arrays (`{ id: ["1", "2"] }`), which is expanded as the cartesian product. CLI shorthand supports several bracket groups (`/blog/:category[tech,design]/:slug[a,b]`).
- The published entry point is `dist/src/index.js`; type definitions ship with the package.
- Releases are managed with Changesets.
