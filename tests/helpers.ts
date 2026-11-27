import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "spa");

export const makeTempDir = (): string => mkdtempSync(path.join(tmpdir(), "jepsh-ssg-"));

/** Copy the fixture "build output" into `parent/dist` and return that path. */
export function copyFixture(parent: string): string {
  const dir = path.join(parent, "dist");
  cpSync(FIXTURE_DIR, dir, { recursive: true });

  return dir;
}

export const cleanup = (dir: string): void => rmSync(dir, { recursive: true, force: true });

/** Chrome's sandbox is unavailable when running as root and on some CI images. */
export const needsNoSandbox = (): boolean => Boolean(process.env.CI) || process.getuid?.() === 0;

/** Capture console.log output and restore the original when done. */
export function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };

  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}

/** Run `fn` with process.cwd() switched to `dir`, restoring it afterwards. */
export async function inDirectory<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(original);
  }
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `file` contains `text`, polling briefly (log writes are fire-and-forget). */
export async function waitForContent(file: string, text: string, timeout = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (existsSync(file) && readFileSync(file, "utf-8").includes(text)) {
      return;
    }

    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for '${text}' in '${file}'`);
    }

    await delay(20);
  }
}
