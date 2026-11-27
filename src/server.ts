import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { ServerHandle } from "./types.js";
import { formatBasePath, getMimeType, logError, logInfo } from "./utils.js";

const HOST = "127.0.0.1";

function statSafe(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Map a URL pathname onto a location inside `root`. Returns null if the
 * pathname is malformed or would escape `root`.
 */
function resolveRequest(root: string, pathname: string): string | null {
  let decoded: string;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) {
    return null;
  }

  // Normalizing against "/" clamps any ".." segments at the root.
  const relative = path.posix.normalize(`/${decoded.replace(/\\/g, "/")}`);
  const target = path.join(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return null;
  }

  return target;
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

export type StartServerOptions = {
  basePath?: string;
  inputDir: string;
  port: number;
};

/**
 * Serve `inputDir` on 127.0.0.1 with SPA fallback to index.html.
 * Pass port 0 to let the OS pick a free port.
 */
export async function startServer({ basePath, inputDir, port }: StartServerOptions): Promise<ServerHandle> {
  const root = path.resolve(inputDir);
  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error(`Input directory '${inputDir}' does not exist or is missing index.html`);
  }

  const formattedBasePath = formatBasePath(basePath);
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      sendText(res, 405, "Method Not Allowed");

      return;
    }

    let pathname = (req.url ?? "/").split("?")[0]?.split("#")[0] || "/";
    if (formattedBasePath && (pathname === formattedBasePath || pathname.startsWith(`${formattedBasePath}/`))) {
      pathname = pathname.slice(formattedBasePath.length) || "/";
    }

    const target = resolveRequest(root, pathname);
    if (!target) {
      sendText(res, 400, "Bad Request");

      return;
    }

    let filePath = target;
    let stats = statSafe(filePath);
    if (stats?.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      stats = statSafe(filePath);
    }

    if (!stats && !path.extname(target)) {
      const htmlPath = `${target}.html`;
      const htmlStats = statSafe(htmlPath);
      if (htmlStats) {
        filePath = htmlPath;
        stats = htmlStats;
      }
    }

    if (!stats && !path.extname(pathname)) {
      filePath = path.join(root, "index.html");
      stats = statSafe(filePath);
    }

    if (!stats || !stats.isFile()) {
      sendText(res, 404, `Not found: '${pathname}'\nEnsure the file exists in '${inputDir}'`);

      return;
    }

    const mimeType = getMimeType(filePath);
    const lastModified = stats.mtime.toUTCString();

    if (req.headers["if-modified-since"] === lastModified && !mimeType.startsWith("text/html")) {
      res.writeHead(304);
      res.end();

      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeType,
      "Content-Length": stats.size,
      "Last-Modified": lastModified,
      "Cache-Control": mimeType.startsWith("image/") || mimeType.includes("font") ? "public, max-age=31536000" : "no-cache",
    });

    if (req.method === "HEAD") {
      res.end();

      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", (error) => {
      logError(`Server error for '${pathname}': ${error.message}`);
      if (res.headersSent) {
        res.destroy();
      } else {
        sendText(res, 500, "Internal Server Error");
      }
    });

    stream.pipe(res);
  });

  return new Promise<ServerHandle>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = address && typeof address === "object" ? address.port : port;
      logInfo(`Serving ${inputDir} at http://${HOST}:${actualPort}${formattedBasePath}`);
      resolve({
        port: actualPort,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
