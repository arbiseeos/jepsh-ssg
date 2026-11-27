import fs from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import chalk from "chalk";
import ora from "ora";

const MIME_TYPES = {
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

export function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

export function formatBasePath(basePath) {
  if (!basePath || basePath === "/") {
    return "";
  }

  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;

  return withLeadingSlash.replace(/\/+$/, "");
}

export function logStamp() {
  return `[${new Date().toLocaleTimeString()}]`;
}

export function logLabel(label) {
  switch (label) {
    case "info":
      return `${chalk.bgCyan.bold(" INFO ")}   `;
    case "success":
      return `${chalk.bgGreen.bold(" SUCCESS ")}`;
    case "warn":
      return `${chalk.bgYellow.bold(" WARN ")}   `;
    case "error":
      return `${chalk.bgRed.bold(" ERROR ")}  `;
  }
}

export function createSpinner(text) {
  return ora({
    text: `${logStamp()} ${logLabel("info")} ${text}\n`,
    spinner: "dots",
    color: "cyan",
  }).start();
}

async function logToFile(message) {
  try {
    const logDir = path.join(".jepsh/debug", "logs");
    await mkdir(logDir, { recursive: true });
    await appendFile(path.join(logDir, "ssg.log"), `${logStamp()} ${stripVTControlCharacters(message)}\n`);
  } catch {
    // Logging to disk must never break a build.
  }
}

export function logHeader() {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  const content = `
  ███████╗███████╗██████╗ ███████╗██╗  ██╗
  ╚══███╔╝██╔════╝██╔══██╗██╔════╝██║  ██║
    ███╔╝ █████╗  ██████╔╝███████╗███████║
   ███╔╝  ██╔══╝  ██╔═══╝ ╚════██║██╔══██║
  ███████╗███████╗██║     ███████║██║  ██║
  ╚══════╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝
  ${packageJson.version.padEnd(20)}`;

  console.log(chalk.cyan.bold(content));
  logToFile(`${logLabel("info")} Jepsh SSG started ...`);
}

export function logConfig(config) {
  const routeCount = config.routes.length;
  const date = new Date().toLocaleString();
  const content = `${chalk.bold("• Configuration")}
  Routes      : ${chalk.green.bold(`${routeCount} route${routeCount !== 1 ? "s" : ""}`)}
  Input       : ${chalk.green.bold(`${config.inputDir}`)}
  Output      : ${chalk.green.bold(`${config.outDir}`)}
  Port        : ${chalk.green.bold(`${config.port}`)}
  Framework   : ${chalk.green.bold(`${config.framework}`)}
  Started     : ${chalk.green.bold(`${date}`)}`;

  console.log(`\n${content}\n`);
}

export function logInfo(message, ...args) {
  const content = `${logLabel("info")} ${message}`;
  console.log(`+ ${logStamp()} ${content}`, ...args);
  logToFile(content);
}

export function logSuccess(message, ...args) {
  const content = `${logLabel("success")} ${message}`;
  console.log(`+ ${logStamp()} ${content}`, ...args);
  logToFile(content);
}

export function logWarn(message, ...args) {
  const content = `${logLabel("warn")} ${message}`;
  console.log(`+ ${logStamp()} ${content}`, ...args);
  logToFile(content);
}

export function logError(message, ...args) {
  const content = `${logLabel("error")} ${message}`;
  console.log(`+ ${logStamp()} ${content}`, ...args);
  logToFile(content);
}

export function logSummary(results, totalDuration) {
  const successful = results.filter((r) => r.status === "success").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
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

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * @param {string[]} routePaths Final, already-expanded route paths (e.g. "/", "/about").
 */
export async function generateSitemap(routePaths, baseUrl, outDir, basePath = "") {
  const origin = baseUrl.replace(/\/+$/, "");
  const lastmod = new Date().toISOString();
  const urls = routePaths.map((route) => `  <url>\n    <loc>${escapeXml(encodeURI(`${origin}${basePath}${route}`))}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`).join("\n");
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  await mkdir(outDir, { recursive: true });
  const sitemapPath = path.join(outDir, "sitemap.xml");
  await writeFile(sitemapPath, sitemap, "utf-8");

  return sitemapPath;
}

export async function clearCache() {
  const cacheFile = path.join(process.cwd(), ".jepsh/caches", "ssg.json");
  if (fs.existsSync(cacheFile)) {
    await fs.promises.rm(cacheFile, { recursive: true, force: true });
  }
}

export async function clearLogs() {
  const logFile = path.join(process.cwd(), ".jepsh/debug/logs", "ssg.log");
  if (fs.existsSync(logFile)) {
    await fs.promises.rm(logFile, { recursive: true, force: true });
  }

  const screenshotsDir = path.join(process.cwd(), ".jepsh/debug/screenshots", "ssg");
  if (fs.existsSync(screenshotsDir)) {
    await fs.promises.rm(screenshotsDir, { recursive: true, force: true });
  }
}
