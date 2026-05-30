import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig, saveConfig, configExists } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import type { DevtunnelConfig } from "../lib/types.js";

export async function config(args: string[]): Promise<void> {
  const force = args.includes("--force");
  const asJson = args.includes("--json");
  const positional = args.filter((a) => a !== "--force" && a !== "--json");
  const [action, key, ...rest] = positional;
  const value = rest.join(" ");

  switch (action) {
    case "set":
      return set(key, value, force);
    case "get":
      return get(key, asJson);
    case "list":
    case undefined:
      return list(asJson);
    default:
      throw new Error(
        "Usage: devtun config [list|set <key> <value> [--force]|get <key>] [--json]"
      );
  }
}

const VALID_KEYS = [
  "domain",
  "devSubdomain",
  "tunnelName",
  "cfTokenSource",
] as const;

type ValidKey = (typeof VALID_KEYS)[number];

async function set(
  key: string | undefined,
  value: string,
  force: boolean
): Promise<void> {
  if (!key || !value) {
    throw new Error("Usage: devtun config set <key> <value> [--force]");
  }
  if (!configExists()) {
    throw new Error('No config found. Run "devtun setup" first.');
  }
  if (!VALID_KEYS.includes(key as ValidKey)) {
    throw new Error(
      `Unknown config key: ${key}\nValid keys: ${VALID_KEYS.join(", ")}`
    );
  }

  const cfg = loadConfig();

  switch (key as ValidKey) {
    case "domain":
      await setDomain(cfg, value, force);
      return;
    case "devSubdomain":
      await setDevSubdomain(cfg, value, force);
      return;
    case "tunnelName":
      setTunnelName(cfg, value);
      return;
    case "cfTokenSource":
      cfg.cfTokenSource = value;
      saveConfig(cfg);
      out.success(`Set cfTokenSource = ${value}`);
      return;
  }
}

async function setDomain(
  cfg: DevtunnelConfig,
  newDomain: string,
  force: boolean
): Promise<void> {
  if (cfg.domain === newDomain) {
    out.info(`domain is already ${newDomain}. No change.`);
    return;
  }

  // Verify token can see the new zone before touching anything.
  const token = resolveToken(cfg);
  cf.setToken(token);

  out.info(`Verifying Cloudflare token has access to ${newDomain}...`);
  try {
    await cf.getZone(newDomain);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Cannot use ${newDomain}: ${msg}\n` +
      `The Cloudflare token must have Zone access to ${newDomain}.`
    );
  }
  out.success(`Token has access to ${newDomain}.`);

  // Check for orphans on the old zone.
  if (cfg.zoneId && !force) {
    const oldHostnames = await cf.listCustomHostnames(cfg.zoneId);
    if (oldHostnames.length > 0) {
      out.blank();
      out.error(
        `${oldHostnames.length} custom hostname(s) still registered on ${cfg.domain}:`
      );
      for (const h of oldHostnames) {
        out.info(`  - ${h.hostname} (${h.status})`);
      }
      out.blank();
      out.info(
        "Run `devtun remove <name>` for each project (from its directory) before changing domain."
      );
      out.info(
        "Or pass --force to abandon them on Cloudflare (they'll stay registered until you delete them in the dashboard)."
      );
      throw new Error("Refusing to change domain while hostnames remain.");
    }
  }

  const oldDomain = cfg.domain;
  cfg.domain = newDomain;
  delete cfg.zoneId;
  delete cfg.accountId;
  delete cfg.tunnelId;
  delete cfg.tunnelToken;
  saveConfig(cfg);

  out.blank();
  out.success(`domain: ${oldDomain} -> ${newDomain}`);
  out.info("Cleared cached zoneId, accountId, tunnelId, tunnelToken.");
  out.info("Run `devtun setup` to provision the new zone.");
}

async function setDevSubdomain(
  cfg: DevtunnelConfig,
  newSubdomain: string,
  force: boolean
): Promise<void> {
  if (cfg.devSubdomain === newSubdomain) {
    out.info(`devSubdomain is already ${newSubdomain}. No change.`);
    return;
  }

  // Check for hostnames on the old subdomain.
  if (cfg.zoneId && !force) {
    const token = resolveToken(cfg);
    cf.setToken(token);

    const hostnames = await cf.listCustomHostnames(cfg.zoneId);
    const suffix = `.${cfg.devSubdomain}`;
    const onOldSubdomain = hostnames.filter((h) => h.hostname.endsWith(suffix));

    if (onOldSubdomain.length > 0) {
      out.blank();
      out.error(
        `${onOldSubdomain.length} custom hostname(s) still on ${cfg.devSubdomain}:`
      );
      for (const h of onOldSubdomain) {
        out.info(`  - ${h.hostname} (${h.status})`);
      }
      out.blank();
      out.info(
        "Run `devtun remove <name>` for each project (from its directory) before changing the subdomain."
      );
      out.info("Or pass --force to abandon them on Cloudflare.");
      throw new Error("Refusing to change subdomain while hostnames remain.");
    }
  }

  const oldSubdomain = cfg.devSubdomain;
  cfg.devSubdomain = newSubdomain;
  saveConfig(cfg);

  out.blank();
  out.success(`devSubdomain: ${oldSubdomain} -> ${newSubdomain}`);
  out.info(
    `Run \`devtun setup\` to reconfigure tunnel ingress for *.${newSubdomain}.`
  );
}

function setTunnelName(cfg: DevtunnelConfig, newName: string): void {
  if (cfg.tunnelName === newName) {
    out.info(`tunnelName is already ${newName}. No change.`);
    return;
  }

  const oldName = cfg.tunnelName;
  const oldId = cfg.tunnelId;
  cfg.tunnelName = newName;
  delete cfg.tunnelId;
  delete cfg.tunnelToken;
  saveConfig(cfg);

  out.blank();
  out.success(`tunnelName: ${oldName} -> ${newName}`);
  out.info("Cleared cached tunnelId and tunnelToken.");
  out.info("Run `devtun setup` to create or find the new tunnel.");
  if (oldId) {
    out.warn(
      `The old tunnel '${oldName}' (${oldId}) is still on Cloudflare. Delete it from the dashboard if no longer needed.`
    );
  }
}

function get(key: string | undefined, asJson: boolean): void {
  if (!key) {
    throw new Error("Usage: devtun config get <key> [--json]");
  }
  if (key === "tunnelToken") {
    throw new Error("tunnelToken is sensitive and cannot be read via `config get`.");
  }
  const cfg = loadConfig();
  const value = (cfg as unknown as Record<string, string | undefined>)[key];
  if (asJson) {
    out.setJsonMode(true);
    out.json({ [key]: value ?? null });
    return;
  }
  if (value === undefined) {
    out.info(`${key}: (not set)`);
  } else {
    console.log(value);
  }
}

function list(asJson: boolean): void {
  if (!configExists()) {
    throw new Error('No config found. Run "devtun setup" first.');
  }
  const cfg = loadConfig();

  if (asJson) {
    out.setJsonMode(true);
    // Never include tunnelToken in JSON output.
    const { tunnelToken: _omit, ...safe } = cfg;
    void _omit;
    out.json(safe);
    return;
  }

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
