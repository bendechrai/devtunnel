import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { DevtunnelConfig } from "./types.js";

const CONFIG_DIR = join(homedir(), ".devtun");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function configDir(): string {
  return CONFIG_DIR;
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export function loadConfig(): DevtunnelConfig {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(
      `No config found. Run "devtun setup" first.`
    );
  }
  const raw = readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as DevtunnelConfig;
}

export function saveConfig(config: DevtunnelConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function writeEnvFile(vars: Record<string, string>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
  const envPath = join(CONFIG_DIR, ".env");
  writeFileSync(envPath, content, { mode: 0o600 });
}
