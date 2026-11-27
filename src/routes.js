const PARAM_ROUTE = /^(.+:(\w+))\[(.+)\]$/;

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a comma-separated route list, ignoring commas inside [...] groups,
 * so "/,/about,/users/:id[1,2]" yields three entries.
 */
export function splitRouteList(input) {
  const parts = [];
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
 * Parse "/,/about,/users/:id[1,2]" into ["/", "/about", { path: "/users/:id", params: [{ id: "1" }, { id: "2" }] }].
 */
export function parseRouteList(input) {
  return splitRouteList(input).map((entry) => {
    const match = entry.match(PARAM_ROUTE);
    if (!match) {
      return entry;
    }

    const [, routePath, key, values] = match;

    return {
      path: routePath,
      params: values.split(",").map((value) => ({ [key]: value.trim() })),
    };
  });
}

export function normalizeRoutePath(route) {
  const normalized = `/${route}`.replace(/\/+/g, "/");

  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

export function isExcluded(route, excludeRoutes = []) {
  return excludeRoutes.some((pattern) => {
    const matcher = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);

    return matcher.test(route);
  });
}

function fillParams(routePath, paramSet) {
  let result = routePath;

  for (const [key, value] of Object.entries(paramSet)) {
    result = result.replace(new RegExp(`:${escapeRegExp(key)}\\b`, "g"), () => String(value));
  }

  return result;
}

/**
 * Expand configured routes (strings and { path, params, timeout } objects)
 * into a flat, de-duplicated list of { path, timeout }, minus excluded routes.
 */
export function expandRoutes(routes, { excludeRoutes = [], timeout } = {}) {
  const expanded = new Map();

  const add = (routePath, routeTimeout) => {
    const normalized = normalizeRoutePath(routePath);
    if (isExcluded(normalized, excludeRoutes) || expanded.has(normalized)) {
      return;
    }

    expanded.set(normalized, { path: normalized, timeout: routeTimeout || timeout });
  };

  for (const route of routes) {
    if (typeof route === "string") {
      add(route, timeout);
    } else if (route && typeof route.path === "string") {
      if (Array.isArray(route.params)) {
        for (const paramSet of route.params) {
          add(fillParams(route.path, paramSet), route.timeout);
        }
      } else {
        add(route.path, route.timeout);
      }
    } else {
      throw new Error(`Invalid route entry: ${JSON.stringify(route)}`);
    }
  }

  return Array.from(expanded.values());
}
