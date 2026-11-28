import fs from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import { expandRoutes, extractParamNames, isRouteGroup } from "./routes.js";
import type { CrawlResult, LogLabel, PackageJson, SsgConfig } from "./types.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

const LABELS: Record<LogLabel, string> = {
  info: `${chalk.bgCyan.bold(" INFO ")}   `,
  success: `${chalk.bgGreen.bold(" SUCCESS ")}`,
  warn: `${chalk.bgYellow.bold(" WARN ")}   `,
  error: `${chalk.bgRed.bold(" ERROR ")}  `,
};

export function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function formatBasePath(basePath?: string): string {
  if (!basePath || basePath === "/") {
    return "";
  }

  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;

  return withLeadingSlash.replace(/\/+$/, "");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logStamp(): string {
  return `[${new Date().toLocaleTimeString()}]`;
}

export function logLabel(label: LogLabel): string {
  return LABELS[label];
}

export function createSpinner(text: string): Ora {
  return ora({
    text: `${logStamp()} ${logLabel("info")} ${text}\n`,
    spinner: "dots",
    color: "cyan",
  }).start();
}

/**
 * Walk up from this module's directory until a package.json is found. This
 * works both from `src/` (tests, `tsx`) and from `dist/src/` (published build).
 */
function findPackageJson(startDir: string): PackageJson {
  let dir = startDir;

  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf-8")) as PackageJson;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Could not find package.json");
    }

    dir = parent;
  }
}

let cachedPackageJson: PackageJson | null = null;

export function readPackageJson(): PackageJson {
  cachedPackageJson ??= findPackageJson(path.dirname(fileURLToPath(import.meta.url)));

  return cachedPackageJson;
}

/**
 * Writes are queued on this promise so entries are appended in call order.
 * Firing them off concurrently lets the kernel interleave the appends, which
 * reorders (and can drop) log lines.
 */
let logQueue: Promise<void> = Promise.resolve();

function logToFile(message: string): Promise<void> {
  const entry = `${logStamp()} ${stripVTControlCharacters(message)}\n`;
  // Resolve the path now: the queued write may run after the cwd has changed.
  const logFile = path.join(process.cwd(), ".jepsh/debug/logs", "ssg.log");

  logQueue = logQueue.then(async () => {
    try {
      await mkdir(path.dirname(logFile), { recursive: true });
      await appendFile(logFile, entry);
    } catch {
      // Logging to disk must never break a build.
    }
  });

  return logQueue;
}

export function logHeader(): void {
  const { version = "0.0.0" } = readPackageJson();
  const content = `
  ███████╗███████╗██████╗ ███████╗██╗  ██╗
  ╚══███╔╝██╔════╝██╔══██╗██╔════╝██║  ██║
    ███╔╝ █████╗  ██████╔╝███████╗███████║
   ███╔╝  ██╔══╝  ██╔═══╝ ╚════██║██╔══██║
  ███████╗███████╗██║     ███████║██║  ██║
  ╚══════╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝
  ${version.padEnd(20)}`;

  console.log(chalk.cyan.bold(content));
  void logToFile(`${logLabel("info")} Jepsh SSG started ...`);
}

export function logConfig(config: SsgConfig): void {
  const expanded = expandRoutes(config.routes, { excludeRoutes: config.excludeRoutes, timeout: config.timeout });
  const dynamic = config.routes.reduce((count, route) => {
    if (typeof route === "string") {
      return count;
    }

    if (isRouteGroup(route)) {
      return count + route.paths.filter((routePath) => extractParamNames(routePath).length > 0).length;
    }

    return count + 1;
  }, 0);
  const routeCount = expanded.length;
  const date = new Date().toLocaleString();
  const content = `${chalk.bold("• Configuration")}
  Routes      : ${chalk.green.bold(`${routeCount} route${routeCount !== 1 ? "s" : ""}${dynamic > 0 ? ` (${dynamic} dynamic)` : ""}`)}
  Input       : ${chalk.green.bold(`${config.inputDir}`)}
  Output      : ${chalk.green.bold(`${config.outDir}`)}
  Port        : ${chalk.green.bold(`${config.port}`)}
  Framework   : ${chalk.green.bold(`${config.framework}`)}
  Started     : ${chalk.green.bold(`${date}`)}`;

  console.log(`\n${content}\n`);
}

export function logInfo(message: string, ...args: unknown[]): void {
  const content = `${logLabel("info")} ${message}`;
  console.log(`+ ${logStamp()} ${content}`, ...args);
  void logToFile(content);
}

export function logSuccess(message: string, ...args: unknown[]): void {
  const content = `${logLabel("success")} ${message}`;
  console.log(`+ ${logStamp()} ${content}`, ...args);
  void logToFile(content);
}

export function logWarn(message: string, ...args: unknown[]): void {
  const content = `${logLabel("warn")} ${message}`;
  console.log(`+ ${logStamp()} ${content}`, ...args);
  void logToFile(content);
}

export function logError(message: string, ...args: unknown[]): void {
  const content = `${logLabel("error")} ${message}`;
  console.log(`+ ${logStamp()} ${content}`, ...args);
  void logToFile(content);
}

export function logSummary(results: readonly CrawlResult[], totalDuration: number): void {
  const successful = results.filter((result) => result.status === "success").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const total = results.length;
  const average = total > 0 ? (totalDuration / total / 1000).toFixed(2) : 0;
  const content = `${chalk.bold("• Reports")}
  Successful  : ${chalk.green.bold(`${successful} route${successful !== 1 ? "s" : ""}`)}${skipped > 0 ? `\n  Skipped     : ${chalk.yellow.bold(`${skipped} route${skipped !== 1 ? "s" : ""}`)}` : ""}
  Failed      : ${chalk.red.bold(`${failed} route${failed !== 1 ? "s" : ""}`)}
  Total       : ${chalk.bold(`${total} route${total !== 1 ? "s" : ""}`)}\n\n${chalk.bold("• Performance")}
  Duration    : ${chalk.cyan.bold(`${(totalDuration / 1000).toFixed(1)}s`)}
  Average     : ${chalk.cyan.bold(`${average}s per route`)}`;

  console.log(`\n${content}\n`);

  if (failed === 0) {
    logSuccess(`All ${total} route(s) processed successfully`);
  } else {
    logWarn(`${successful} route(s) processed successfully, ${failed} failed`);
  }
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Write `sitemap.xml` for final, already-expanded route paths
 * (e.g. "/", "/about", "/users/1").
 */
export async function generateSitemap(routePaths: readonly string[], baseUrl: string, outDir: string, basePath = ""): Promise<string> {
  const origin = baseUrl.replace(/\/+$/, "");
  const lastmod = new Date().toISOString();
  const urls = routePaths.map((route) => `  <url>\n    <loc>${escapeXml(encodeURI(`${origin}${basePath}${route}`))}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`).join("\n");
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  await mkdir(outDir, { recursive: true });
  const sitemapPath = path.join(outDir, "sitemap.xml");
  await writeFile(sitemapPath, sitemap, "utf-8");

  return sitemapPath;
}

export async function clearCache(): Promise<void> {
  const cacheFile = path.join(process.cwd(), ".jepsh/caches", "ssg.json");
  if (fs.existsSync(cacheFile)) {
    await fs.promises.rm(cacheFile, { recursive: true, force: true });
  }
}

export async function clearLogs(): Promise<void> {
  await logQueue; // let queued writes finish so they cannot recreate the file

  const logFile = path.join(process.cwd(), ".jepsh/debug/logs", "ssg.log");
  if (fs.existsSync(logFile)) {
    await fs.promises.rm(logFile, { recursive: true, force: true });
  }

  const screenshotsDir = path.join(process.cwd(), ".jepsh/debug/screenshots", "ssg");
  if (fs.existsSync(screenshotsDir)) {
    await fs.promises.rm(screenshotsDir, { recursive: true, force: true });
  }
}
