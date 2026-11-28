---
"@arbiseeos/jepsh-ssg": minor
---

Add route groups to the configuration: `{ params, paths }` shares one set of parameter value domains across several routes, so localized trees no longer repeat `params` on every entry. Group parameters are scoped to the group, every path expands only the placeholders it contains, and an optional `timeout` applies to the whole group. Groups work identically in `jepsh.config.*` and `package.json#jepsh.ssg`.
