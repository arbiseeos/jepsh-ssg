import type { CliOptions, ConfigOverrides, Framework } from "./types.js";
import { parseRouteList } from "./routes.js";

function toInt(value: string): number {
  return Number.parseInt(value, 10);
}

function toList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Translate parsed CLI flags into config overrides. Only flags that were
 * actually passed are included, so config-file values are never clobbered.
 */
export function buildOverrides(options: CliOptions): ConfigOverrides {
  const overrides: ConfigOverrides = {};

  if (options.routes) overrides.routes = options.routes.trim() === "auto" ? "auto" : parseRouteList(options.routes);
  if (options.basePath !== undefined) overrides.basePath = options.basePath;
  if (options.baseUrl) overrides.baseUrl = options.baseUrl;
  if (options.inputDir) overrides.inputDir = options.inputDir;
  if (options.outDir) overrides.outDir = options.outDir;
  if (options.port !== undefined) overrides.port = toInt(options.port);
  if (options.concurrency) overrides.concurrency = toInt(options.concurrency);
  if (options.flatOutput) overrides.flatOutput = true;
  if (options.hydrate) overrides.hydrate = true;
  if (options.hydrateBundle) overrides.hydrateBundle = options.hydrateBundle;
  if (options.framework) overrides.framework = options.framework as Framework;
  if (options.batchSize) overrides.batchSize = toInt(options.batchSize);
  if (options.incremental) overrides.incremental = true;
  if (options.timeout) overrides.timeout = toInt(options.timeout);
  if (options.inlineCss) overrides.inlineCss = true;
  if (options.sitemap) overrides.sitemap = true;
  if (options.excludeRoutes) overrides.excludeRoutes = toList(options.excludeRoutes);
  if (options.customSelectors) overrides.customSelectors = toList(options.customSelectors);
  if (options.disableSandbox) overrides.disableSandbox = true;
  if (options.browserArgs) overrides.browserArgs = toList(options.browserArgs);

  return overrides;
}
