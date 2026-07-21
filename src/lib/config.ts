import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { DevtunnelConfig } from "./types.js";

/** Directory of the default instance. Prefer InstanceContext.dir in commands. */
export function configDir(): string {
  return join(homedir(), ".devtun");
}

function configFile(dir: string): string {
  return join(dir, "config.json");
}

export function configExists(dir: string): boolean {
  return existsSync(configFile(dir));
}

export function loadConfig(dir: string): DevtunnelConfig {
  const file = configFile(dir);
  if (!existsSync(file)) {
    throw new Error(
      `No config found. Run "devtun setup" first.`
    );
  }
  const raw = readFileSync(file, "utf-8");
  return JSON.parse(raw) as DevtunnelConfig;
}

export function saveConfig(dir: string, config: DevtunnelConfig): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(configFile(dir), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function writeEnvFile(dir: string, vars: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
  const envPath = join(dir, ".env");
  writeFileSync(envPath, content, { mode: 0o600 });
}

export const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";

export function dockerSocketOf(config: DevtunnelConfig): string {
  return config.dockerSocket ?? DEFAULT_DOCKER_SOCKET;
}
