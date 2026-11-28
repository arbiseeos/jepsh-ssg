import type { DynamicRoute, ResolvedRoute, RouteEntry, RouteGroup, RouteParamGrid, RouteParamSet, RouteParamValue } from "./types.js";

const CLI_PARAM_GROUP = /:(\w+)\[([^\]]*)\]/g;
const PLACEHOLDER = /:(\w+)/g;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a comma-separated route list, ignoring commas inside [...] groups,
 * so "/,/about,/users/:id[1,2]" yields three entries.
 */
export function splitRouteList(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of input) {
    if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth = Math.max(0, depth - 1);
    }

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  parts.push(current);

  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Parse "/,/about,/users/:id[1,2]" into
 * ["/", "/about", { path: "/users/:id", params: [{ id: "1" }, { id: "2" }] }].
 *
 * Several bracketed groups in one route form a cartesian product, so
 * "/blog/:category[x,y]/:slug[1,2]" crawls four URLs.
 */
export function parseRouteList(input: string): RouteEntry[] {
  return splitRouteList(input).map((entry) => {
    const groups: { name: string; values: string[] }[] = [];
    const routePath = entry.replace(CLI_PARAM_GROUP, (_match, name: string, raw: string) => {
      const values = raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      groups.push({ name, values });

      return `:${name}`;
    });

    if (groups.length === 0) {
      return entry;
    }

    const params: Record<string, string[]> = {};
    for (const group of groups) {
      params[group.name] = group.values;
    }

    return { path: routePath, params };
  });
}

/** Normalize to a single leading slash and no trailing slash (except for "/"). */
export function normalizeRoutePath(route: string): string {
  const normalized = `/${route}`.replace(/\/+/g, "/");

  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

/** Test a route against glob-like exclusion patterns (`/api/*`). */
export function isExcluded(route: string, excludeRoutes: readonly string[] = []): boolean {
  return excludeRoutes.some((pattern) => {
    const matcher = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);

    return matcher.test(route);
  });
}

/** The `:name` placeholders of a route path, in the order they appear. */
export function extractParamNames(routePath: string): string[] {
  return Array.from(routePath.matchAll(PLACEHOLDER), (match) => match[1] ?? "").filter(Boolean);
}

function assertUniquePlaceholders(routePath: string): string[] {
  const names = extractParamNames(routePath);
  const seen = new Set<string>();

  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`Route '${routePath}' uses the parameter ':${name}' more than once`);
    }

    seen.add(name);
  }

  return names;
}

function paramValue(routePath: string, name: string, value: RouteParamValue | undefined): string {
  if (value === undefined) {
    throw new Error(`Route '${routePath}' has no value for ':${name}'`);
  }

  const text = String(value);
  if (text.trim() === "") {
    throw new Error(`Route '${routePath}' has an empty value for ':${name}'`);
  }

  if (/[/?#]/.test(text)) {
    throw new Error(`Value '${text}' for ':${name}' of route '${routePath}' must not contain '/', '?' or '#'`);
  }

  return text;
}

function missingParamsError(routePath: string, names: readonly string[], hint = ""): Error {
  const list = names.map((name) => `':${name}'`).join(", ");

  return new Error(`Route '${routePath}' contains the placeholder${names.length === 1 ? "" : "s"} ${list} but no params were provided${hint}`);
}

function fillParams(routePath: string, paramSet: RouteParamSet, names: readonly string[]): string {
  let result = routePath;

  for (const name of names) {
    const value = paramValue(routePath, name, paramSet[name]);
    result = result.replace(new RegExp(`:${escapeRegExp(name)}(?!\\w)`, "g"), () => value);
  }

  return result;
}

function isParamSet(value: unknown): value is RouteParamSet {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandParamSets(route: DynamicRoute, params: RouteParamSet[], names: readonly string[]): string[] {
  if (params.length === 0) {
    throw new Error(`Route '${route.path}' has an empty params list`);
  }

  return params.map((paramSet, index) => {
    if (!isParamSet(paramSet)) {
      throw new Error(`Route '${route.path}' params[${index}] must be an object of parameter values`);
    }

    const keys = Object.keys(paramSet);
    for (const name of names) {
      if (!keys.includes(name)) {
        throw new Error(`Route '${route.path}' params[${index}] is missing the parameter ':${name}'`);
      }
    }

    for (const key of keys) {
      if (!names.includes(key)) {
        throw new Error(`Route '${route.path}' params[${index}] contains an unknown parameter '${key}'${names.length > 0 ? ` (expected ${names.map((name) => `'${name}'`).join(", ")})` : ""}`);
      }
    }

    return fillParams(route.path, paramSet, names);
  });
}

function expandParamGrid(routePath: string, params: RouteParamGrid, names: readonly string[]): string[] {
  const keys = Object.keys(params);

  for (const name of names) {
    if (!keys.includes(name)) {
      throw new Error(`Route '${routePath}' is missing values for ':${name}'`);
    }
  }

  for (const key of keys) {
    if (!names.includes(key)) {
      throw new Error(`Route '${routePath}' has values for '${key}', which is not a placeholder in the path`);
    }

    const values = params[key];
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`Route '${routePath}' needs at least one value for ':${key}'`);
    }
  }

  // Cartesian product, ordered by placeholder appearance in the path.
  let sets: RouteParamSet[] = [{}];
  for (const name of names) {
    const values = params[name] ?? [];
    const next: RouteParamSet[] = [];
    for (const paramSet of sets) {
      for (const value of values) {
        next.push({ ...paramSet, [name]: value });
      }
    }

    sets = next;
  }

  return sets.map((paramSet) => fillParams(routePath, paramSet, names));
}

/** True when an entry declares shared `params` and a list of `paths`. */
export function isRouteGroup(entry: RouteEntry): entry is RouteGroup {
  return typeof entry === "object" && entry !== null && Array.isArray((entry as RouteGroup).paths);
}

/**
 * Expand a route group: its `params` domains are shared by every path, and a
 * path expands only the placeholders it actually contains.
 */
export function expandRouteGroup(group: RouteGroup): string[] {
  const params: unknown = group.params;

  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("Route group params must be an object of value arrays");
  }

  const grid = params as RouteParamGrid;
  const keys = Object.keys(grid);
  if (keys.length === 0) {
    throw new Error("Route group params must define at least one parameter");
  }

  for (const key of keys) {
    const values = grid[key];
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`Route group needs at least one value for ':${key}'`);
    }
  }

  if (!Array.isArray(group.paths) || group.paths.length === 0) {
    throw new Error("Route group paths must be a non-empty array of route paths");
  }

  const expanded: string[] = [];

  group.paths.forEach((routePath: unknown, index) => {
    if (typeof routePath !== "string" || routePath.trim() === "") {
      throw new Error(`Route group paths[${index}] must be a route path string`);
    }

    const names = assertUniquePlaceholders(routePath);
    if (names.length === 0) {
      expanded.push(routePath);
      return;
    }

    const pathGrid: Record<string, readonly RouteParamValue[]> = {};
    for (const name of names) {
      const values = grid[name];
      if (values === undefined) {
        throw missingParamsError(routePath, [name], ". Declare it in the route group's params");
      }

      pathGrid[name] = values;
    }

    expanded.push(...expandParamGrid(routePath, pathGrid, names));
  });

  return expanded;
}

/**
 * Expand one configured route entry into concrete route paths.
 *
 * Every placeholder must be provided by `params`, and `params` may not
 * describe parameters the path does not contain. A plain string containing a
 * placeholder is rejected instead of being crawled as a literal URL.
 */
export function expandRouteEntry(route: RouteEntry): string[] {
  if (typeof route === "string") {
    const names = assertUniquePlaceholders(route);
    if (names.length > 0) {
      throw missingParamsError(route, names, `. Use { path: '${route}', params: [...] } or the CLI shorthand '${route.replace(/:(\w+)/g, ":$1[value]")}'`);
    }

    return [route];
  }

  if (isRouteGroup(route)) {
    throw new Error("Route groups are expanded by expandRouteGroup(); they cannot be passed to expandRouteEntry()");
  }

  if (!route || typeof route !== "object" || typeof route.path !== "string") {
    throw new Error(`Invalid route entry: ${JSON.stringify(route)}`);
  }

  const names = assertUniquePlaceholders(route.path);
  const params = route.params;

  if (params === undefined) {
    if (names.length > 0) {
      throw missingParamsError(route.path, names);
    }

    return [route.path];
  }

  if (Array.isArray(params)) {
    if (names.length === 0) {
      throw new Error(`Route '${route.path}' has no placeholders but params were provided`);
    }

    return expandParamSets(route, params, names);
  }

  if (!isParamSet(params)) {
    throw new Error(`Route '${route.path}' params must be an array of parameter sets or an object of value arrays`);
  }

  if (Object.keys(params).length === 0) {
    throw new Error(`Route '${route.path}' has an empty params object`);
  }

  if (names.length === 0) {
    throw new Error(`Route '${route.path}' has no placeholders but params were provided`);
  }

  return expandParamGrid(route.path, params, names);
}

/**
 * Expand configured routes into a flat, de-duplicated list of
 * `{ path, timeout }`, minus excluded routes.
 */
export function expandRoutes(routes: readonly RouteEntry[], { excludeRoutes = [], timeout }: { excludeRoutes?: readonly string[]; timeout?: number } = {}): ResolvedRoute[] {
  const expanded = new Map<string, ResolvedRoute>();

  const add = (routePath: string, routeTimeout: number | undefined): void => {
    const normalized = normalizeRoutePath(routePath);
    if (isExcluded(normalized, excludeRoutes) || expanded.has(normalized)) {
      return;
    }

    expanded.set(normalized, { path: normalized, timeout: routeTimeout ?? timeout });
  };

  for (const route of routes) {
    if (isRouteGroup(route)) {
      for (const routePath of expandRouteGroup(route)) {
        add(routePath, route.timeout);
      }

      continue;
    }

    const entryTimeout = typeof route === "string" ? undefined : route.timeout;
    for (const routePath of expandRouteEntry(route)) {
      add(routePath, entryTimeout);
    }
  }

  return Array.from(expanded.values());
}
