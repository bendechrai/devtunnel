import * as out from "../lib/output.js";
import { loadConfig, saveConfig, configExists } from "../lib/config.js";

export async function config(args: string[]): Promise<void> {
  const [action, key, ...rest] = args;
  const value = rest.join(" ");

  switch (action) {
    case "set":
      return set(key, value);
    case "get":
      return get(key);
    case "list":
    case undefined:
      return list();
    default:
      throw new Error(
        "Usage: devtun config [list|set <key> <value>|get <key>]"
      );
  }
}

const VALID_KEYS = [
  "domain",
  "devSubdomain",
  "tunnelName",
  "cfTokenSource",
] as const;

function set(key: string | undefined, value: string): void {
  if (!key || !value) {
    throw new Error("Usage: devtun config set <key> <value>");
  }
  if (!configExists()) {
    throw new Error('No config found. Run "devtun setup" first.');
  }
  if (!VALID_KEYS.includes(key as (typeof VALID_KEYS)[number])) {
    throw new Error(
      `Unknown config key: ${key}\nValid keys: ${VALID_KEYS.join(", ")}`
    );
  }

  const cfg = loadConfig();
  (cfg as unknown as Record<string, string>)[key] = value;
  saveConfig(cfg);
  out.success(`Set ${key} = ${value}`);
}

function get(key: string | undefined): void {
  if (!key) {
    throw new Error("Usage: devtun config get <key>");
  }
  const cfg = loadConfig();
  const value = (cfg as unknown as Record<string, string | undefined>)[key];
  if (value === undefined) {
    out.info(`${key}: (not set)`);
  } else {
    console.log(value);
  }
}

function list(): void {
  if (!configExists()) {
    throw new Error('No config found. Run "devtun setup" first.');
  }
  const cfg = loadConfig();
  out.header("devtun config");
  out.info(`domain:        ${cfg.domain}`);
  out.info(`devSubdomain:  ${cfg.devSubdomain}`);
  out.info(`tunnelName:    ${cfg.tunnelName}`);
  out.info(`cfTokenSource: ${cfg.cfTokenSource ?? "(not set - using env var)"}`);
  out.info(`tunnelId:      ${cfg.tunnelId ?? "(not set)"}`);
  out.info(`zoneId:        ${cfg.zoneId ?? "(not set)"}`);
  out.info(`accountId:     ${cfg.accountId ?? "(not set)"}`);
  out.blank();
  out.dim("~/.devtun/config.json");
  out.blank();
}
