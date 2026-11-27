/** Frameworks whose default content selectors the crawler knows about. */
export type Framework = "react" | "vite" | "vue" | "svelte";

/** A value substituted into a `:param` placeholder. */
export type RouteParamValue = string | number;

/** One complete set of parameter values for a route. */
export type RouteParamSet = Record<string, RouteParamValue>;

/** Every placeholder mapped to the values that should be crawled for it. */
export type RouteParamGrid = Record<string, readonly RouteParamValue[]>;

/**
 * A route with placeholders.
 *
 * `params` accepts either:
 * - an array of complete parameter sets (`[{ id: "1" }, { id: "2" }]`), or
 * - an object of arrays (`{ id: ["1", "2"], lang: ["en", "de"] }`) expanded as
 *   the cartesian product in placeholder order.
 */
export type DynamicRoute = {
  path: string;
  params?: RouteParamSet[] | RouteParamGrid;
  timeout?: number;
};

/** A route exactly as written in a config file or on the command line. */
export type RouteEntry = string | DynamicRoute;

/** A single crawlable URL after placeholders have been filled in. */
export type ResolvedRoute = {
  path: string;
  timeout: number | undefined;
};

type CrawlResultBase = {
  route: string;
};

export type CrawlSuccess = CrawlResultBase & {
  status: "success";
  filePath: string;
  fileSize: string;
  duration: string;
};

export type CrawlSkipped = CrawlResultBase & {
  status: "skipped";
  filePath: string;
  fileSize: string;
  duration: number;
};

export type CrawlFailure = CrawlResultBase & {
  status: "failed";
  error: string;
};

export type CrawlResult = CrawlSuccess | CrawlSkipped | CrawlFailure;

/** Every field except `routes`, with its resolved value. */
export type SsgOptions = {
  basePath: string;
  baseUrl: string;
  inputDir: string;
  outDir: string;
  port: number;
  concurrency: number;
  flatOutput: boolean;
  hydrate: boolean;
  hydrateBundle: string | null;
  framework: Framework;
  batchSize: number;
  incremental: boolean;
  timeout: number;
  inlineCss: boolean;
  sitemap: boolean;
  excludeRoutes: string[];
  customSelectors: string[];
  disableSandbox: boolean;
  browserArgs: string[];
};

/** A fully resolved configuration, as returned by `loadConfig()`. */
export type SsgConfig = SsgOptions & {
  routes: RouteEntry[];
};

/** Values read from `jepsh.config.*` or `package.json#jepsh.ssg`. */
export type UserConfig = Partial<SsgOptions> & {
  routes?: RouteEntry[] | "auto";
};

/** Values parsed from CLI flags; only flags that were passed are present. */
export type ConfigOverrides = Partial<SsgOptions> & {
  routes?: RouteEntry[] | "auto";
};

/** Options accepted by `crawlRoutes()`. Defaults are applied per field. */
export type CrawlOptions = Partial<SsgOptions> & {
  routes: RouteEntry[];
  inputDir: string;
  outDir: string;
  port: number;
};

export type ServerHandle = {
  port: number;
  close: () => Promise<void>;
};

export type LogLabel = "info" | "success" | "warn" | "error";

/** The subset of `package.json` this package reads. */
export type PackageJson = {
  name?: string;
  version?: string;
  type?: string;
  jepsh?: {
    ssg?: UserConfig;
  };
};

/** Raw commander flags. String flags can be absent; booleans are flags. */
export type CliOptions = {
  routes?: string;
  basePath?: string;
  baseUrl?: string;
  inputDir?: string;
  outDir?: string;
  port?: string;
  concurrency?: string;
  flatOutput?: boolean;
  hydrate?: boolean;
  hydrateBundle?: string;
  framework?: string;
  batchSize?: string;
  incremental?: boolean;
  timeout?: string;
  inlineCss?: boolean;
  sitemap?: boolean;
  excludeRoutes?: string;
  customSelectors?: string;
  disableSandbox?: boolean;
  browserArgs?: string;
  watch?: boolean;
  dryRun?: boolean;
  clearCache?: boolean;
  clearLogs?: boolean;
  clean?: boolean;
};
