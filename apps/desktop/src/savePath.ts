// Pure path join for the default-save-folder feature. Kept DOM-free/testable.
// Uses the separator already present in the directory (backslash on Windows,
// forward slash elsewhere), defaulting to "/".

export function joinSavePath(dir: string, filename: string): string {
  const usesBackslash = dir.includes("\\") && !dir.includes("/");
  const sep = usesBackslash ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  return `${trimmed}${sep}${filename}`;
}
