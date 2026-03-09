const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

export function header(text: string): void {
  console.log(`\n${BOLD}${text}${RESET}\n`);
}

export function step(n: number, text: string): void {
  console.log(`${BOLD}Step ${n}:${RESET} ${text}`);
}

export function info(text: string): void {
  console.log(`  ${text}`);
}

export function success(text: string): void {
  console.log(`  ${GREEN}${text}${RESET}`);
}

export function warn(text: string): void {
  console.log(`  ${YELLOW}${text}${RESET}`);
}

export function error(text: string): void {
  console.error(`${RED}Error:${RESET} ${text}`);
}

export function dim(text: string): void {
  console.log(`  ${DIM}${text}${RESET}`);
}

export function url(text: string): void {
  console.log(`  ${CYAN}${text}${RESET}`);
}

export function blank(): void {
  console.log();
}

export function table(
  rows: Array<Record<string, string>>,
  columns: string[]
): void {
  if (rows.length === 0) return;

  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => (r[col] ?? "").length))
  );

  const headerLine = columns
    .map((col, i) => col.padEnd(widths[i]))
    .join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  console.log(`  ${DIM}${headerLine}${RESET}`);
  console.log(`  ${DIM}${separator}${RESET}`);
  for (const row of rows) {
    const line = columns
      .map((col, i) => (row[col] ?? "").padEnd(widths[i]))
      .join("  ");
    console.log(`  ${line}`);
  }
}
