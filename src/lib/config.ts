import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { DevtunnelConfig } from "./types.js";

export function configDir(): string {
  return join(homedir(), ".devtun");
}

function configFile(): string {
  return join(configDir(), "config.json");
}

export function configExists(): boolean {
  return existsSync(configFile());
}

export function loadConfig(): DevtunnelConfig {
  const file = configFile();
  if (!existsSync(file)) {
    throw new Error(
      `No config found. Run "devtun setup" first.`
    );
  }
  const raw = readFileSync(file, "utf-8");
  return JSON.parse(raw) as DevtunnelConfig;
}

export function saveConfig(config: DevtunnelConfig): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function writeEnvFile(vars: Record<string, string>): void {
  mkdirSync(configDir(), { recursive: true });
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
  const envPath = join(configDir(), ".env");
  writeFileSync(envPath, content, { mode: 0o600 });
}
