/** Small formatting helpers shared by every tool implementation. */

export interface Truncated {
  text: string;
  truncated: boolean;
  originalLength: number;
}

/** Cut `text` down to `maxChars`, keeping the head and the tail. */
export function truncate(text: string, maxChars: number): Truncated {
  const originalLength = text.length;
  if (maxChars <= 0 || originalLength <= maxChars) {
    return { text, truncated: false, originalLength };
  }
  const marker = `\n... [truncated ${originalLength - maxChars} characters] ...\n`;
  const head = Math.max(0, Math.floor((maxChars - marker.length) * 0.7));
  const tail = Math.max(0, maxChars - marker.length - head);
  const sliced = `${text.slice(0, head)}${marker}${text.slice(originalLength - tail)}`;
  return { text: sliced, truncated: true, originalLength };
}

/**
 * Render a command result as the text block returned to the MCP client.
 * Keeps stdout/stderr labels only when there is something to show.
 */
export function renderCommandResult(
  result: { stdout?: string; stderr?: string; exitCode?: number | null },
  maxChars: number,
): string {
  const parts: string[] = [];
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout.trim().length > 0) parts.push(stdout.replace(/\n$/, ""));
  if (stderr.trim().length > 0) parts.push(`[stderr]\n${stderr.replace(/\n$/, "")}`);
  if (parts.length === 0) parts.push("(no output)");
  parts.push(`[exitCode: ${result.exitCode ?? "unknown"}]`);
  return truncate(parts.join("\n"), maxChars).text;
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** `entry.name  type  size  path` lines for one directory listing. */
export function renderDirEntries(
  entries: Array<{ name: string; type?: string; path?: string; size?: number; isDir?: boolean }>,
  maxChars: number,
): string {
  if (entries.length === 0) return "(empty directory)";
  const lines = entries.map((entry) => {
    const isDir = entry.isDir ?? entry.type === "dir";
    const kind = isDir ? "dir " : "file";
    const size = isDir ? "-" : formatBytes(entry.size ?? 0);
    const target = entry.path ?? entry.name;
    return `${kind}  ${size.padStart(10)}  ${target}`;
  });
  return truncate(lines.join("\n"), maxChars).text;
}

/** Render a code-interpreter `Execution` into plain text. */
export function renderExecution(
  execution: {
    logs?: { stdout?: string[]; stderr?: string[] };
    results?: Array<{ text?: string; png?: string; jpeg?: string; svg?: string; html?: string; json?: unknown; chart?: unknown; data?: Record<string, unknown> }>;
    error?: { name?: string; value?: string; traceback?: string };
  },
  maxChars: number,
): string {
  const parts: string[] = [];
  const stdout = (execution.logs?.stdout ?? []).join("").replace(/\n$/, "");
  const stderr = (execution.logs?.stderr ?? []).join("").replace(/\n$/, "");
  if (stdout.length > 0) parts.push(stdout);
  if (stderr.length > 0) parts.push(`[stderr]\n${stderr}`);

  for (const [index, item] of (execution.results ?? []).entries()) {
    if (typeof item.text === "string" && item.text.length > 0) {
      parts.push(`[result ${index + 1}]\n${item.text}`);
      continue;
    }
    if (item.png) parts.push(`[result ${index + 1}] <png image, ${item.png.length} base64 chars>`);
    else if (item.jpeg) parts.push(`[result ${index + 1}] <jpeg image, ${item.jpeg.length} base64 chars>`);
    else if (item.svg) parts.push(`[result ${index + 1}] <svg, ${item.svg.length} chars>`);
    else if (item.html) parts.push(`[result ${index + 1}] <html, ${item.html.length} chars>`);
    else if (item.json !== undefined) parts.push(`[result ${index + 1}]\n${JSON.stringify(item.json)}`);
    else if (item.data !== undefined) parts.push(`[result ${index + 1}]\n${JSON.stringify(item.data)}`);
  }

  if (execution.error) {
    const name = execution.error.name ?? "Error";
    const value = execution.error.value ?? "";
    parts.push(`[error] ${name}: ${value}`);
    if (execution.error.traceback) parts.push(execution.error.traceback);
  }

  if (parts.length === 0) parts.push("(no output)");
  return truncate(parts.join("\n"), maxChars).text;
}
