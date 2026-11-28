---
"@arbiseeos/jepsh-ssg": patch
---

Use `domcontentloaded` for Puppeteer navigation so background network activity does not block route rendering. The crawler's framework content checks remain responsible for determining when the page is ready to capture.
