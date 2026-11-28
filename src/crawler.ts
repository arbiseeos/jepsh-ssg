import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import BeastiesImport, { type Options as BeastiesOptions } from "beasties";
import pLimit from "p-limit";
import prettyBytes from "pretty-bytes";
import puppeteer, { type Browser, type HTTPRequest, type Page } from "puppeteer";
import { errorMessage, createSpinner, formatBasePath, generateSitemap, logError, logInfo, logLabel, logStamp, logSuccess, logWarn } from "./utils.js";
import { escapeRegExp, expandRoutes } from "./routes.js";
import type { CrawlOptions, CrawlResult, Framework } from "./types.js";

// beasties ships an ESM build but CommonJS-flavoured declarations, which
// NodeNext resolves to the module namespace instead of the default class.
type BeastiesConstructor = new (options: BeastiesOptions) => { process(html: string): Promise<string> };
const Beasties = BeastiesImport as unknown as BeastiesConstructor;

const CACHE_DIR = ".jepsh/caches";
const CACHE_FILE = path.join(CACHE_DIR, "ssg.json");
const FRAMEWORK_SELECTORS: Record<Framework, string[]> = {
  react: ["#root > *", "#app > *", "[data-reactroot]"],
  vite: ["#root > *", "#app > *"],
  vue: ["#app > *"],
  svelte: ["[data-svelte]", "body > div > *"],
};

type Cache = {
  fingerprint: string;
  routes: Record<string, string>;
};

function toLocalAssetPath(src: string, basePath: string): string | null {
  // Skip absolute and protocol-relative URLs (CDN scripts).
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(src)) {
    return null;
  }

  let local = src;
  if (basePath && local.startsWith(`${basePath}/`)) {
    local = local.slice(basePath.length);
  }

  return local.replace(/^\.?\//, "");
}

/** Locate the app's main JS bundle (relative to inputDir) for hydration. */
export function findBundle(inputDir: string, basePath = ""): string | null {
  const indexPath = path.join(inputDir, "index.html");
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, "utf-8");
    for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/gi)) {
      const src = toLocalAssetPath(match[1] ?? "", basePath);
      if (src && fs.existsSync(path.join(inputDir, src))) {
        return src;
      }
    }
  }

  const files = fs.readdirSync(inputDir, { recursive: true }).map((file) => String(file).replace(/\\/g, "/"));

  return files.find((file) => file.endsWith(".js") && !file.includes("chunk") && !file.includes("vendor")) ?? null;
}

/**
 * Add the hydration bundle as a module script unless the rendered page already
 * references it. The serialized DOM normally contains the app's own script tag,
 * so injecting unconditionally would load the bundle twice.
 */
export function injectHydrationScript(html: string, src: string, basePath = ""): { html: string; injected: boolean; scriptUrl: string } {
  const scriptUrl = `${basePath}/${src.replace(/\\/g, "/")}`.replace(/\/+/g, "/");
  const alreadyPresent = new RegExp(`<script\\b[^>]*\\bsrc=["']${escapeRegExp(scriptUrl)}["']`, "i");
  if (alreadyPresent.test(html)) {
    return { html, injected: false, scriptUrl };
  }

  const tag = `<script type="module" src="${scriptUrl}"></script>`;
  const closingBody = html.lastIndexOf("</body>");
  const result = closingBody === -1 ? html + tag : html.slice(0, closingBody) + tag + html.slice(closingBody);

  return { html: result, injected: true, scriptUrl };
}

function findSourceFile(inputDir: string, route: string): string {
  const shell = path.join(inputDir, "index.html");
  if (route === "/") {
    return shell;
  }

  const candidates = [path.join(inputDir, route, "index.html"), path.join(inputDir, `${route}.html`)];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? shell;
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function loadCache(fingerprint: string): Promise<Cache> {
  const empty: Cache = { fingerprint, routes: {} };
  if (!fs.existsSync(CACHE_FILE)) {
    return empty;
  }

  try {
    const cache = JSON.parse(await readFile(CACHE_FILE, "utf-8")) as Cache;
    if (cache.fingerprint !== fingerprint) {
      logInfo("Build options changed since the last run. Ignoring cache");

      return empty;
    }

    logInfo(`Loaded cache from '${CACHE_FILE}'`);

    return cache;
  } catch (error) {
    logWarn(`Failed to load cache: ${errorMessage(error)}`);

    return empty;
  }
}

export async function crawlRoutes({
  routes,
  basePath = "",
  baseUrl = "http://localhost:3000",
  inputDir,
  outDir,
  port,
  concurrency = 3,
  flatOutput = false,
  hydrate = false,
  hydrateBundle = null,
  framework = "react",
  batchSize = 50,
  incremental = false,
  timeout = 30000,
  inlineCss = false,
  sitemap = false,
  excludeRoutes = [],
  customSelectors = [],
  disableSandbox = false,
  browserArgs = [],
}: CrawlOptions): Promise<CrawlResult[]> {
  const results: CrawlResult[] = [];
  const spinner = createSpinner("Starting route crawling ...");
  const formattedBasePath = formatBasePath(basePath);
  const processedRoutes = expandRoutes(routes, { excludeRoutes, timeout });

  const outputPathFor = (route: string): string => {
    if (route === "/") {
      return path.join(outDir, "index.html");
    }

    return flatOutput ? path.join(outDir, `${route.replace(/^\//, "")}.html`) : path.join(outDir, route, "index.html");
  };

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ hydrate, hydrateBundle, framework, customSelectors, inlineCss, flatOutput, basePath: formattedBasePath }))
    .digest("hex");

  await mkdir(CACHE_DIR, { recursive: true });

  const cache: Cache = incremental ? await loadCache(fingerprint) : { fingerprint, routes: {} };

  // Decide which routes can be skipped before copying inputDir over outDir,
  // so previously rendered pages are not clobbered by the raw SPA shell.
  const toCrawl: { path: string; timeout: number | undefined; sourceHash: string | null }[] = [];
  const preserved = new Set<string>();

  for (const route of processedRoutes) {
    const outputPath = outputPathFor(route.path);
    const sourceHash = fs.existsSync(path.join(inputDir, "index.html")) ? hashFile(findSourceFile(inputDir, route.path)) : null;
    const unchanged = incremental && sourceHash !== null && cache.routes[route.path] === sourceHash && fs.existsSync(outputPath);
    if (unchanged) {
      preserved.add(path.resolve(outputPath));

      logInfo(`Skipped '${route.path}' (unchanged)`);
      results.push({ route: route.path, status: "skipped", filePath: outputPath, fileSize: prettyBytes(fs.statSync(outputPath).size), duration: 0 });
    } else {
      toCrawl.push({ ...route, sourceHash });
    }
  }

  fs.cpSync(inputDir, outDir, { recursive: true, filter: (_src, dest) => !preserved.has(path.resolve(dest)) });
  spinner.succeed(`${logStamp()} ${logLabel("success")} Copied '${inputDir}' → '${outDir}'`);

  let scriptSrc: string | null = null;

  if (hydrate) {
    scriptSrc = hydrateBundle ? hydrateBundle.replace(/^\.?\//, "") : findBundle(inputDir, formattedBasePath);
    if (scriptSrc && !fs.existsSync(path.join(inputDir, scriptSrc))) {
      logWarn(`Hydration bundle '${scriptSrc}' not found in '${inputDir}'. Skipping script injection`);
      scriptSrc = null;
    } else if (scriptSrc) {
      logInfo(`Using hydration bundle: '${scriptSrc}'`);
    } else {
      logWarn(`No hydration bundle found in '${inputDir}'. Skipping script injection`);
    }
  }

  if (toCrawl.length > 0) {
    const selectors = customSelectors.length > 0 ? customSelectors : (FRAMEWORK_SELECTORS[framework] ?? ["body > div > *"]);
    const launchArgs = [...(disableSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : []), ...browserArgs];
    const browser: Browser = await puppeteer.launch({ headless: true, args: launchArgs });

    try {
      // One page per concurrent slot. A page is checked out for the duration of
      // a route, so two routes never navigate the same page at once.
      const idlePages: Page[] = [];

      for (let i = 0; i < Math.min(concurrency, toCrawl.length); i++) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        await page.setRequestInterception(true);
        page.on("request", (req: HTTPRequest) => {
          if (["image", "font"].includes(req.resourceType()) && !inlineCss) {
            void req.abort();
          } else {
            void req.continue();
          }
        });

        page.on("console", (msg) => {
          if (msg.type() === "error") {
            logWarn(`Browser console error: ${msg.text()}`);
          }
        });

        page.on("pageerror", (error: unknown) => {
          logWarn(`Page error: ${errorMessage(error)}`);
        });

        idlePages.push(page);
      }

      const limit = pLimit(concurrency);
      const beasties = new Beasties({ path: inputDir, publicPath: formattedBasePath ? `${formattedBasePath}/` : "/", logLevel: "silent" });
      const batchCount = Math.ceil(toCrawl.length / batchSize);

      for (let i = 0; i < toCrawl.length; i += batchSize) {
        const batch = toCrawl.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const batchSpinner = createSpinner(`Processing batch ${batchNumber}/${batchCount} (${batch.length} routes) ...`);

        await Promise.all(
          batch.map(({ path: route, timeout: routeTimeout, sourceHash }) =>
            limit(async () => {
              const page = idlePages.pop() as Page;
              const startTime = Date.now();
              const crawlPath = `${formattedBasePath}${route}`.replace(/\/+/g, "/");
              const fullUrl = `http://127.0.0.1:${port}${crawlPath}`;
              const routeSpinner = createSpinner(`Crawling: '${fullUrl}' ...`);

              try {
                // Wait for the document, not network idleness: apps may keep background requests open.
                // Framework-specific selectors below determine when the rendered app is ready to capture.
                await page.goto(fullUrl, {
                  waitUntil: "domcontentloaded",
                  timeout: routeTimeout,
                });
                let contentFound = false;

                for (const selector of selectors) {
                  try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    contentFound = true;
                    routeSpinner.succeed(`${logStamp()} ${logLabel("success")} Content found with selector: '${selector}' for '${route}'`);

                    break;
                  } catch {
                    logWarn(`Selector '${selector}' not found for '${route}', trying next ...`);
                  }
                }

                if (!contentFound) {
                  logWarn(`No framework content selectors found for '${route}', waiting for general content ...`);
                  await page.waitForFunction(() => document.body.children.length > 0 && (document.body.textContent ?? "").trim().length > 0, { timeout: 10000 });
                  routeSpinner.succeed(`${logStamp()} ${logLabel("success")} General content loaded for '${route}'`);
                }

                await new Promise((resolve) => setTimeout(resolve, 1000));
                let html = await page.content();

                if (inlineCss) {
                  try {
                    html = await beasties.process(html);
                    logSuccess(`CSS inlined for '${route}'`);
                  } catch (error) {
                    logWarn(`CSS inlining failed for '${route}': ${errorMessage(error)}`);
                  }
                }

                if (hydrate && scriptSrc) {
                  const injection = injectHydrationScript(html, scriptSrc, formattedBasePath);
                  html = injection.html;
                  if (injection.injected) {
                    logSuccess(`Hydration script injected for '${route}': '${injection.scriptUrl}'`);
                  } else {
                    logInfo(`Hydration bundle already present for '${route}': '${injection.scriptUrl}'`);
                  }
                }

                const outputFilePath = outputPathFor(route);
                await mkdir(path.dirname(outputFilePath), { recursive: true });
                await writeFile(outputFilePath, html, "utf-8");
                const fileSize = prettyBytes(fs.statSync(outputFilePath).size);
                const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                logSuccess(`'${route}' → '${outputFilePath}' (${fileSize}) ${duration}s`);
                results.push({ route, status: "success", filePath: outputFilePath, fileSize, duration });

                // Only record a route in the cache once it has rendered successfully.
                if (incremental && sourceHash) {
                  cache.routes[route] = sourceHash;
                }
              } catch (error) {
                logError(`Crawling failed for route '${route}': ${errorMessage(error)}`);

                try {
                  const screenshotPath = path.join(".jepsh/debug", `screenshots/ssg/${route.replace(/\/+/g, "_")}.png`);
                  await mkdir(path.dirname(screenshotPath), { recursive: true });
                  await page.screenshot({ path: screenshotPath });
                  logInfo(`Debug screenshot saved: '${screenshotPath}'`);
                } catch {
                  logError("Could not save debug screenshot");
                }

                routeSpinner.fail(`${logStamp()} ${logLabel("error")} Failed: '${route}'`);
                results.push({ route, status: "failed", error: errorMessage(error) });
              } finally {
                idlePages.push(page);
              }
            })
          )
        );

        batchSpinner.succeed(`${logStamp()} ${logLabel("success")} Batch ${batchNumber} completed`);
      }
    } finally {
      await browser.close();
    }
  }

  if (incremental) {
    try {
      await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
      logInfo(`Cache saved: '${CACHE_FILE}'`);
    } catch (error) {
      logWarn(`Failed to save cache: ${errorMessage(error)}`);
    }
  }

  if (sitemap) {
    const routePaths = processedRoutes.map((route) => route.path);
    const sitemapPath = await generateSitemap(routePaths, baseUrl, outDir, formattedBasePath);
    logSuccess(`Sitemap generated: '${sitemapPath}'`);
  }

  spinner.succeed(`${logStamp()} ${logLabel("success")} Crawling finished`);

  return results;
}
