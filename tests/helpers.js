import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "spa");

export const makeTempDir = () => mkdtempSync(path.join(tmpdir(), "jepsh-ssg-"));

/** Copy the fixture "build output" into `parent/dist` and return that path. */
export function copyFixture(parent) {
  const dir = path.join(parent, "dist");
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

export const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

/** Chrome's sandbox is unavailable when running as root and on some CI images. */
export const needsNoSandbox = () => Boolean(process.env.CI) || process.getuid?.() === 0;
