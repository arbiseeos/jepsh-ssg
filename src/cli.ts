import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { Command } from "commander";
import type { CliOptions, CrawlResult, SsgConfig } from "./types.js";
import { crawlRoutes } from "./crawler.js";
import { loadConfig } from "./config.js";
import { buildOverrides } from "./options.js";
import { expandRoutes } from "./routes.js";
import { startServer } from "./server.js";
import { clearCache, clearLogs, errorMessage, logConfig, logError, logHeader, logInfo, logSuccess, logSummary, readPackageJson } from "./utils.js";

/** Build the commander program. Exposed so flags can be tested. */
export function createProgram(): Command {
  const { version = "0.0.0" } = readPackageJson();

  return new Command()
    .name("sssg")
    .version(version)
    .option("--routes <routes>", "Comma-separated routes, or 'auto' (e.g., /,/about,/users/:id[1,2])")
    .option("--base-path <path>", "Base path for routes")
    .option("--base-url <url>", "Base URL for sitemap")
    .option("-i, --input-dir <path>", "Input directory")
    .option("-o, --out-dir <path>", "Output directory")
    .option("-p, --port <number>", "Port to run server on (0 picks a free port)")
    .option("--concurrency <number>", "Number of concurrent crawls")
    .option("--flat-output", "Use flat output file structure")
    .option("--hydrate", "Inject hydration script")
    .option("--hydrate-bundle <path>", "Path to hydration bundle (relative to inputDir)")
    .option("--framework <name>", "Framework to use (react, vite, vue, svelte)")
    .option("--batch-size <number>", "Number of routes per batch")
    .option("--incremental", "Enable incremental builds")
    .option("-t, --timeout <number>", "Timeout per route in ms")
    .option("--inline-css", "Enable critical CSS inlining")
    .option("--sitemap", "Generate sitemap")
    .option("--exclude-routes <routes>", "Comma-separated routes to exclude")
    .option("--custom-selectors <selectors>", "Comma-separated custom selectors")
    .option("--disable-sandbox", "Launch Chrome without its sandbox (needed in some containers/CI)")
    .option("--browser-args <args>", "Comma-separated extra Chrome arguments")
    .option("--watch", "Watch for file changes and rebuild")
    .option("--dry-run", "Preview routes without writing files")
    .option("--clear-cache", "Clear cached data in .jepsh")
    .option("--clear-logs", "Clear logs in .jepsh")
    .option("--clean", "Clear all cache and logs in .jepsh");
}

export async function runBuild(config: SsgConfig, dryRun = false): Promise<CrawlResult[]> {
  if (dryRun) {
    logInfo("Dry run mode: Previewing routes ...");
    for (const route of expandRoutes(config.routes, { excludeRoutes: config.excludeRoutes, timeout: config.timeout })) {
      logInfo(`Route: '${route.path}'`);
    }

    return [];
  }

  const startTime = Date.now();
  const server = await startServer({ basePath: config.basePath, inputDir: config.inputDir, port: config.port });

  try {
    const results = await crawlRoutes({ ...config, port: server.port });
    logSummary(results, Date.now() - startTime);

    return results;
  } finally {
    await server.close();
  }
}

export async function runWatch(config: SsgConfig, dryRun: boolean): Promise<FSWatcher> {
  let running = false;
  let queued = false;
  let timer: NodeJS.Timeout | undefined;

  const rebuild = async (): Promise<void> => {
    if (running) {
      queued = true;

      return;
    }

    running = true;

    try {
      await runBuild(config, dryRun);
    } catch (error) {
      logError(`Error: ${errorMessage(error)}`);
    } finally {
      running = false;

      if (queued) {
        queued = false;
        await rebuild();
      }
    }
  };

  logInfo("Starting watch mode ...");

  await rebuild();

  const outDir = path.resolve(config.outDir);
  const watcher = watch(config.inputDir, {
    persistent: true,
    ignoreInitial: true,
    ignored: (watchedPath: string) => path.resolve(watchedPath).startsWith(outDir),
  });

  watcher.on("all", (_event, changedPath) => {
    logInfo(`File changed: '${changedPath}'. Triggering rebuild ...`);
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 300);
  });

  return watcher;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  program.parse(argv);
  const options = program.opts<CliOptions>();

  process.on("SIGINT", () => {
    logInfo("Received Ctrl+C, shutting down ...");
    process.exit(130);
  });

  logHeader();

  if (options.clearCache || options.clean) {
    await clearCache();
  }

  if (options.clearLogs || options.clean) {
    await clearLogs();
  }

  if (options.clearCache || options.clearLogs || options.clean) {
    logSuccess(options.clean ? "All cache and logs cleared successfully" : options.clearCache ? "Cache cleared successfully" : "Logs cleared successfully");

    return;
  }

  try {
    const config = await loadConfig({ overrides: buildOverrides(options) });
    logConfig(config);

    if (options.watch) {
      await runWatch(config, Boolean(options.dryRun));

      return;
    }

    const results = await runBuild(config, Boolean(options.dryRun));
    if (results.some((result) => result.status === "failed")) {
      process.exitCode = 1;
    } else if (!options.dryRun) {
      logSuccess("Done!");
    }
  } catch (error) {
    logError(`Error: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
