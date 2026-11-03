import fs from "node:fs";
import path from "node:path";

export function isTestPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  return normalized.split("/").some((part) => ["test", "tests", "__tests__", "fixtures", "__fixtures__"].includes(part))
    || /(?:^|\/)(?:test_|.*\.(?:test|spec)\.)/.test(normalized);
}

/** Conservative cross-platform policy, including Windows aliases on Unix hosts. */
export function validateSourcePath(value: string): string {
  if (!value || value.length > 1024 || /[\x00-\x1f\x7f:"\\]/.test(value)
      || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) throw new Error("Unsafe source path");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("Unsafe source path");
  if (parts.some((part) => /^(?:\.git|node_modules|\.board|\.ssh|\.aws)$/i.test(part)
      || /^\.env(?:\.|$)/i.test(part) || /credential|secret|private[._-]?key/i.test(part)
      || /\.(?:pem|key|db|db-wal|db-shm)$/i.test(part))) throw new Error("Forbidden sensitive source path");
  if (isTestPath(value)) throw new Error("Safety guard: Cannot auto-modify test fixture or test file");
  return value;
}

export function resolveSourceFile(root: string, relative: string): string {
  validateSourcePath(relative);
  const realRoot = fs.realpathSync(root);
  let file = realRoot;
  for (const part of relative.split("/")) {
    file = path.join(file, part);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error("Source path contains a symbolic link or junction");
  }
  const real = fs.realpathSync(file);
  const within = path.relative(realRoot, real);
  if (!within || within.startsWith(".." + path.sep) || within === ".." || path.isAbsolute(within)) throw new Error("Source escapes workspace");
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error("Source must be a regular file without hard links");
  return real;
}
