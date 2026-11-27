import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import inquirer from "inquirer";
import { logInfo } from "./utils.js";
import { parseRouteList } from "./routes.js";

const CONFIG_FILES = ["jepsh.config.js", "jepsh.config.mjs", "jepsh.config.cjs"];
const FRAMEWORKS = ["react", "vite", "vue", "svelte"];
const DEFAULT_CONFIG = {
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

function autoDetectRoutes(inputDir) {
  const routes = new Set(["/"]);
  const scanDir = (dir, base = "") => {
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

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(message) {
  return function (input) {
    const num = Number.parseInt(input, 10);

    return Number.isInteger(num) && num >= 1 ? true : message;
  };
}

async function promptConfig() {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "routes",
      message: "Routes to crawl ('auto', or comma-separated, e.g., /,/about,/users/:id[1,2]):",
      default: "auto",
      validate: (input) => (input.trim() ? true : "At least one route is required"),
    },
    { type: "input", name: "basePath", message: "Base path for routes (e.g., /app):", default: "" },
    {
      type: "input",
      name: "baseUrl",
      message: "Base URL for sitemap (e.g., https://example.com):",
      default: "http://localhost:3000",
      validate: (input) => (/^(http|https):\/\/[^ "]+$/.test(input) ? true : "Invalid URL format"),
    },
    {
      type: "input",
      name: "inputDir",
      message: "Input directory (where your built files are located):",
      default: "build",
      validate: (input) => {
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
      validate: (input) => {
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
      when: (current) => current.hydrate,
    },
    { type: "list", name: "framework", message: "Framework to use:", choices: FRAMEWORKS, default: "react" },
    { type: "input", name: "batchSize", message: "Number of routes per batch:", default: 50, validate: positiveInteger("Batch size must be a positive number") },
    { type: "confirm", name: "incremental", message: "Enable incremental builds (only recrawl changed routes)?", default: false },
    { type: "input", name: "timeout", message: "Timeout per route in ms:", default: 30000, validate: positiveInteger("Timeout must be a positive number") },
    { type: "confirm", name: "inlineCss", message: "Inline critical CSS in generated HTML?", default: false },
    { type: "confirm", name: "sitemap", message: "Generate sitemap.xml?", default: false },
    { type: "input", name: "excludeRoutes", message: "Routes to exclude (comma-separated, e.g., /api/*):", default: "" },
    { type: "input", name: "customSelectors", message: "Custom content selectors (comma-separated, e.g., #app > *):", default: "" },
  ]);

  return {
    ...answers,
    routes: answers.routes.trim() === "auto" ? "auto" : parseRouteList(answers.routes),
    port: Number.parseInt(answers.port, 10),
    concurrency: Number.parseInt(answers.concurrency, 10),
    batchSize: Number.parseInt(answers.batchSize, 10),
    timeout: Number.parseInt(answers.timeout, 10),
    hydrateBundle: answers.hydrateBundle || null,
    excludeRoutes: splitList(answers.excludeRoutes),
    customSelectors: splitList(answers.customSelectors),
  };
}

async function saveConfig(config, cwd) {
  const configPath = path.join(cwd, "jepsh.config.js");
  if (fs.existsSync(configPath)) {
    return;
  }

  // The config file must match the host project's module type.
  let isEsm = false;

  try {
    isEsm = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")).type === "module";
  } catch {
    // No readable package.json: default to CommonJS.
  }

  const body = JSON.stringify({ ssg: config }, null, 2);
  await fs.promises.writeFile(configPath, `${isEsm ? "export default" : "module.exports ="} ${body};\n`, "utf-8");
  logInfo(`Saved configuration to '${configPath}'`);
}

async function readUserConfig(cwd) {
  let found = false;
  let config = {};

  for (const name of CONFIG_FILES) {
    const configPath = path.join(cwd, name);
    if (fs.existsSync(configPath)) {
      const configModule = await import(pathToFileURL(configPath).href);
      config = { ...config, ...(configModule.default?.ssg ?? configModule.ssg ?? {}) };
      found = true;

      break;
    }
  }

  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (pkg.jepsh?.ssg) {
      config = { ...config, ...pkg.jepsh.ssg };
      found = true;
    }
  }

  return { config, found };
}

function validateConfig(config, cwd) {
  const isPositiveInt = (value) => Number.isInteger(value) && value >= 1;

  if (!Array.isArray(config.routes) || config.routes.length === 0) throw new Error("Routes must be a non-empty array");
  if (config.baseUrl && !/^(http|https):\/\/[^ "]+$/.test(config.baseUrl)) throw new Error(`Invalid baseUrl: '${config.baseUrl}'`);
  if (!config.inputDir || !fs.existsSync(path.resolve(cwd, config.inputDir))) throw new Error(`Input directory '${config.inputDir}' does not exist`);
  if (!fs.existsSync(path.resolve(cwd, config.inputDir, "index.html"))) throw new Error(`No index.html found in '${config.inputDir}'`);
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error("Port must be a number between 0 and 65535");
  if (!isPositiveInt(config.concurrency)) throw new Error("Concurrency must be a positive number");
  if (config.hydrateBundle !== null && typeof config.hydrateBundle !== "string") throw new Error("hydrateBundle must be a string or null");
  if (!FRAMEWORKS.includes(config.framework)) throw new Error(`Framework must be one of: ${FRAMEWORKS.join(", ")}`);
  if (!isPositiveInt(config.batchSize)) throw new Error("Batch size must be a positive number");
  if (!isPositiveInt(config.timeout)) throw new Error("Timeout must be a positive number");
  if (!Array.isArray(config.excludeRoutes)) throw new Error("excludeRoutes must be an array");
  if (!Array.isArray(config.customSelectors)) throw new Error("customSelectors must be an array");
  if (!Array.isArray(config.browserArgs)) throw new Error("browserArgs must be an array");
}

/**
 * Resolve the final configuration: defaults < config file / package.json < CLI overrides.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] Project directory (defaults to process.cwd()).
 * @param {object} [options.overrides] Values that take precedence (e.g. parsed CLI flags).
 * @param {boolean} [options.interactive] Allow the first-run prompt when no config exists.
 */
export async function loadConfig({ cwd = process.cwd(), overrides = {}, interactive = Boolean(process.stdin.isTTY) } = {}) {
  const { config: userConfig, found } = await readUserConfig(cwd);

  let promptedConfig = {};

  if (!found && !overrides.routes && interactive && fs.existsSync(path.join(cwd, "package.json"))) {
    logInfo("No configuration found. Starting interactive mode ...");
    promptedConfig = await promptConfig();
    await saveConfig(promptedConfig, cwd);
  }

  const config = { ...DEFAULT_CONFIG, ...promptedConfig, ...userConfig, ...overrides };
  if (typeof config.routes === "string") {
    config.routes = config.routes.trim() === "auto" ? autoDetectRoutes(path.resolve(cwd, config.inputDir)) : parseRouteList(config.routes);
  }

  validateConfig(config, cwd);

  return config;
}
