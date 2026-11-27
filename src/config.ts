import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import inquirer from "inquirer";
import type { ConfigOverrides, Framework, SsgConfig, UserConfig } from "./types.js";
import { logInfo } from "./utils.js";
import { expandRoutes, parseRouteList } from "./routes.js";

const CONFIG_FILES = ["jepsh.config.js", "jepsh.config.mjs", "jepsh.config.cjs"];
const FRAMEWORKS: readonly Framework[] = ["react", "vite", "vue", "svelte"];

export const DEFAULT_CONFIG: SsgConfig = {
  routes: ["/"],
  basePath: "",
  baseUrl: "http://localhost:3000",
  inputDir: "build",
  outDir: "build-ssg",
  port: 3000,
  concurrency: 3,
  flatOutput: false,
  hydrate: false,
  hydrateBundle: null,
  framework: "react",
  batchSize: 50,
  incremental: false,
  timeout: 30000,
  inlineCss: false,
  sitemap: false,
  excludeRoutes: [],
  customSelectors: [],
  disableSandbox: false,
  browserArgs: [],
};

/** Answers collected by the interactive first-run wizard. */ export type PromptQuestion = {
  type: string;
  name: string;
  message: string;
  default?: unknown;
  choices?: readonly string[];
  when?: (current: { hydrate?: boolean }) => boolean;
  validate?: (input: string) => true | string;
};

export type PromptAnswers = {
  routes: string;
  basePath: string;
  baseUrl: string;
  inputDir: string;
  outDir: string;
  port: string | number;
  concurrency: string | number;
  flatOutput: boolean;
  hydrate: boolean;
  hydrateBundle: string;
  framework: Framework;
  batchSize: string | number;
  incremental: boolean;
  timeout: string | number;
  inlineCss: boolean;
  sitemap: boolean;
  excludeRoutes: string;
  customSelectors: string;
};

export function autoDetectRoutes(inputDir: string): string[] {
  const routes = new Set(["/"]);
  const scanDir = (dir: string, base = ""): void => {
    if (!fs.existsSync(dir)) {
      return;
    }

    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        scanDir(filePath, `${base}/${file}`);
      } else if (file === "index.html") {
        routes.add(base || "/");
      } else if (file.endsWith(".html")) {
        routes.add(`${base}/${file.replace(/\.html$/, "")}`);
      }
    }
  };

  scanDir(inputDir);

  return Array.from(routes);
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(message: string): (input: string) => true | string {
  return function validate(input: string): true | string {
    const num = Number.parseInt(input, 10);

    return Number.isInteger(num) && num >= 1 ? true : message;
  };
}

/** Convert raw prompt answers into a config object. Pure, so it is testable. */
export function normalizePromptAnswers(answers: PromptAnswers): UserConfig {
  return {
    routes: answers.routes.trim() === "auto" ? "auto" : parseRouteList(answers.routes),
    basePath: answers.basePath,
    baseUrl: answers.baseUrl,
    inputDir: answers.inputDir,
    outDir: answers.outDir,
    port: Number.parseInt(String(answers.port), 10),
    concurrency: Number.parseInt(String(answers.concurrency), 10),
    flatOutput: answers.flatOutput,
    hydrate: answers.hydrate,
    hydrateBundle: answers.hydrateBundle || null,
    framework: answers.framework,
    batchSize: Number.parseInt(String(answers.batchSize), 10),
    incremental: answers.incremental,
    timeout: Number.parseInt(String(answers.timeout), 10),
    inlineCss: answers.inlineCss,
    sitemap: answers.sitemap,
    excludeRoutes: splitList(answers.excludeRoutes),
    customSelectors: splitList(answers.customSelectors),
  };
}

/**
 * Ask the interactive wizard questions. Exposed so the wizard can be tested
 * without a real terminal.
 */
export async function promptConfig(ask: (questions: PromptQuestion[]) => Promise<PromptAnswers> = defaultAsk): Promise<UserConfig> {
  const answers = await ask(promptQuestions());

  return normalizePromptAnswers(answers);
}

async function defaultAsk(questions: PromptQuestion[]): Promise<PromptAnswers> {
  return (await inquirer.prompt(questions as never)) as PromptAnswers;
}

/** The questions asked by the interactive wizard. Exposed for testing. */
export function promptQuestions(): PromptQuestion[] {
  return [
    {
      type: "input",
      name: "routes",
      message: "Routes to crawl ('auto', or comma-separated, e.g., /,/about,/users/:id[1,2]):",
      default: "auto",
      validate: (input: string) => (input.trim() ? true : "At least one route is required"),
    },
    { type: "input", name: "basePath", message: "Base path for routes (e.g., /app):", default: "" },
    {
      type: "input",
      name: "baseUrl",
      message: "Base URL for sitemap (e.g., https://example.com):",
      default: "http://localhost:3000",
      validate: (input: string) => (/^(http|https):\/\/[^ "]+$/.test(input) ? true : "Invalid URL format"),
    },
    {
      type: "input",
      name: "inputDir",
      message: "Input directory (where your built files are located):",
      default: "build",
      validate: (input: string) => {
        if (!fs.existsSync(input)) {
          return `Directory '${input}' does not exist`;
        }

        if (!fs.existsSync(path.join(input, "index.html"))) {
          return `No index.html found in '${input}'`;
        }

        return true;
      },
    },
    { type: "input", name: "outDir", message: "Output directory (where static files will be saved):", default: "build-ssg" },
    {
      type: "input",
      name: "port",
      message: "Server port:",
      default: 3000,
      validate: (input: string) => {
        const port = Number.parseInt(input, 10);

        return Number.isInteger(port) && port >= 1 && port <= 65535 ? true : "Port must be a number between 1 and 65535";
      },
    },
    { type: "input", name: "concurrency", message: "Number of concurrent crawls:", default: 3, validate: positiveInteger("Concurrency must be a positive number") },
    { type: "confirm", name: "flatOutput", message: "Use flat output structure (e.g., about.html instead of about/index.html)?", default: false },
    { type: "confirm", name: "hydrate", message: "Inject hydration script for client-side rendering?", default: false },
    {
      type: "input",
      name: "hydrateBundle",
      message: "Path to hydration bundle (relative to inputDir, e.g., assets/index.js, or leave blank to auto-detect):",
      default: "",
      when: (current: { hydrate?: boolean }) => Boolean(current.hydrate),
    },
    { type: "list", name: "framework", message: "Framework to use:", choices: FRAMEWORKS, default: "react" },
    { type: "input", name: "batchSize", message: "Number of routes per batch:", default: 50, validate: positiveInteger("Batch size must be a positive number") },
    { type: "confirm", name: "incremental", message: "Enable incremental builds (only recrawl changed routes)?", default: false },
    { type: "input", name: "timeout", message: "Timeout per route in ms:", default: 30000, validate: positiveInteger("Timeout must be a positive number") },
    { type: "confirm", name: "inlineCss", message: "Inline critical CSS in generated HTML?", default: false },
    { type: "confirm", name: "sitemap", message: "Generate sitemap.xml?", default: false },
    { type: "input", name: "excludeRoutes", message: "Routes to exclude (comma-separated, e.g., /api/*):", default: "" },
    { type: "input", name: "customSelectors", message: "Custom content selectors (comma-separated, e.g., #app > *):", default: "" },
  ];
}

export async function saveConfig(config: UserConfig, cwd: string): Promise<void> {
  const configPath = path.join(cwd, "jepsh.config.js");
  if (fs.existsSync(configPath)) {
    return;
  }

  // The config file must match the host project's module type.
  let isEsm = false;

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")) as { type?: string };
    isEsm = pkg.type === "module";
  } catch {
    // No readable package.json: default to CommonJS.
  }

  const body = JSON.stringify({ ssg: config }, null, 2);
  await fs.promises.writeFile(configPath, `${isEsm ? "export default" : "module.exports ="} ${body};\n`, "utf-8");
  logInfo(`Saved configuration to '${configPath}'`);
}

export async function readUserConfig(cwd: string): Promise<{ config: UserConfig; found: boolean }> {
  let found = false;
  let config: UserConfig = {};

  for (const name of CONFIG_FILES) {
    const configPath = path.join(cwd, name);
    if (fs.existsSync(configPath)) {
      const configModule = (await import(pathToFileURL(configPath).href)) as { default?: { ssg?: UserConfig }; ssg?: UserConfig };
      config = { ...config, ...(configModule.default?.ssg ?? configModule.ssg ?? {}) };
      found = true;

      break;
    }
  }

  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { jepsh?: { ssg?: UserConfig } };
    if (pkg.jepsh?.ssg) {
      config = { ...config, ...pkg.jepsh.ssg };
      found = true;
    }
  }

  return { config, found };
}

export function isFramework(value: unknown): value is Framework {
  return typeof value === "string" && FRAMEWORKS.includes(value as Framework);
}

export function validateConfig(config: SsgConfig, cwd: string): void {
  const isPositiveInt = (value: number): boolean => Number.isInteger(value) && value >= 1;

  if (!Array.isArray(config.routes) || config.routes.length === 0) throw new Error("Routes must be a non-empty array");
  if (config.baseUrl && !/^(http|https):\/\/[^ "]+$/.test(config.baseUrl)) throw new Error(`Invalid baseUrl: '${config.baseUrl}'`);
  if (!config.inputDir || !fs.existsSync(path.resolve(cwd, config.inputDir))) throw new Error(`Input directory '${config.inputDir}' does not exist`);
  if (!fs.existsSync(path.resolve(cwd, config.inputDir, "index.html"))) throw new Error(`No index.html found in '${config.inputDir}'`);
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error("Port must be a number between 0 and 65535");
  if (!isPositiveInt(config.concurrency)) throw new Error("Concurrency must be a positive number");
  if (config.hydrateBundle !== null && typeof config.hydrateBundle !== "string") throw new Error("hydrateBundle must be a string or null");
  if (!isFramework(config.framework)) throw new Error(`Framework must be one of: ${FRAMEWORKS.join(", ")}`);
  if (!isPositiveInt(config.batchSize)) throw new Error("Batch size must be a positive number");
  if (!isPositiveInt(config.timeout)) throw new Error("Timeout must be a positive number");
  if (!Array.isArray(config.excludeRoutes)) throw new Error("excludeRoutes must be an array");
  if (!Array.isArray(config.customSelectors)) throw new Error("customSelectors must be an array");
  if (!Array.isArray(config.browserArgs)) throw new Error("browserArgs must be an array");

  // Surface route configuration errors (missing params, unknown placeholders,
  // duplicate values) before a build starts.
  expandRoutes(config.routes, { excludeRoutes: config.excludeRoutes, timeout: config.timeout });
}

export type LoadConfigOptions = {
  cwd?: string;
  overrides?: ConfigOverrides;
  interactive?: boolean;
};

/**
 * Resolve the final configuration: defaults < config file / package.json < CLI overrides.
 */
export async function loadConfig({ cwd = process.cwd(), overrides = {}, interactive = Boolean(process.stdin.isTTY) }: LoadConfigOptions = {}): Promise<SsgConfig> {
  const { config: userConfig, found } = await readUserConfig(cwd);

  let promptedConfig: UserConfig = {};

  if (!found && !overrides.routes && interactive && fs.existsSync(path.join(cwd, "package.json"))) {
    logInfo("No configuration found. Starting interactive mode ...");
    promptedConfig = await promptConfig();
    await saveConfig(promptedConfig, cwd);
  }

  const merged: UserConfig = { ...DEFAULT_CONFIG, ...promptedConfig, ...userConfig, ...overrides };
  const routes =
    typeof merged.routes === "string"
      ? merged.routes.trim() === "auto"
        ? autoDetectRoutes(path.resolve(cwd, merged.inputDir ?? DEFAULT_CONFIG.inputDir))
        : parseRouteList(merged.routes)
      : (merged.routes ?? DEFAULT_CONFIG.routes);

  const config: SsgConfig = {
    ...DEFAULT_CONFIG,
    ...promptedConfig,
    ...userConfig,
    ...overrides,
    routes,
  };

  validateConfig(config, cwd);

  return config;
}
