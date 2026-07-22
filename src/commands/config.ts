import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig, saveConfig, configExists } from "../lib/config.js";
import { resolveInstance, type InstanceContext } from "../lib/instance.js";
import { resolveToken } from "../lib/token.js";
import { parseFlags } from "../lib/flags.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";
import type { DevtunnelConfig } from "../lib/types.js";

const configHelp: HelpDoc = {
  command: "config",
  synopsis:
    "devtun config [list] [--instance <name>] [--json]\n  devtun config get <key> [--instance <name>] [--json]\n  devtun config set <key> <value> [--instance <name>] [--force]",
  description:
    "Show or modify an instance's config.json (~/.devtun for the default instance,\n~/.devtun/instances/<name> for named instances). `set` validates against Cloudflare for destructive\nchanges: changing `domain` verifies the token can access the new zone and refuses if hostnames remain\non the old zone (unless --force); changing `devSubdomain` refuses if hostnames are still on the old\nsubdomain; changing `tunnelName` clears the cached tunnelId/tunnelToken. tunnelToken is never exposed.\n\nInfra keys: `dockerSocket` (host Docker socket the instance targets), `publishHttpPort` and\n`dashboardPort` (host-port publishing, off by default; value is a port number or 'off').\nRun `devtun up` after changing them to apply.",
  args: [
    { name: "key", description: "domain | devSubdomain | tunnelName | cfTokenSource | dockerSocket | publishHttpPort | dashboardPort" },
    { name: "value", description: "(set only) New value for the key" },
  ],
  flags: [
    { name: "instance", aliases: ["i"], type: "string", description: "Target instance. Defaults to DEVTUN_INSTANCE or 'devtun'." },
    { name: "json", description: "Emit JSON. For `list`, the config object minus tunnelToken. For `get`, { [key]: value }." },
    { name: "force", description: "(set only) Skip the orphan-hostname safety check." },
    { name: "help", aliases: ["h"], description: "Show this help" },
  ],
  env: [{ name: "CLOUDFLARE_API_TOKEN", description: "Cloudflare API token, used by `set domain` to validate access to the new zone." }],
  exits: [
    { code: 0, meaning: "Success" },
    { code: 1, meaning: "Invalid key, unsafe change without --force, or Cloudflare API failure" },
  ],
  examples: [
    { description: "Show current config", command: "devtun config" },
    { description: "Get a single value", command: "devtun config get domain" },
    { description: "JSON for scripting", command: "devtun config --json | jq .domain" },
    { description: "Change domain (refuses if hostnames still on old zone)", command: "devtun config set domain new.example.com" },
  ],
};

export async function config(args: string[]): Promise<void> {
  if (handleHelp(args, configHelp)) return;
  const { positional, flags } = parseFlags(args, {
    boolean: ["force", "json"],
    string: ["instance"],
    aliases: { i: "instance" },
  });
  const force = flags["force"] === true;
  const asJson = flags["json"] === true;
  const inst = resolveInstance(flags);
  const [action, key, ...rest] = positional;
  const value = rest.join(" ");

  switch (action) {
    case "set":
      return set(inst, key, value, force);
    case "get":
      return get(inst, key, asJson);
    case "list":
    case undefined:
      return list(inst, asJson);
    default:
      throw new Error(
        "Usage: devtun config [list|set <key> <value> [--force]|get <key>] [--instance <name>] [--json]"
      );
  }
}

const VALID_KEYS = [
  "domain",
  "devSubdomain",
  "tunnelName",
  "cfTokenSource",
  "dockerSocket",
  "publishHttpPort",
  "dashboardPort",
] as const;

type ValidKey = (typeof VALID_KEYS)[number];

async function set(
  inst: InstanceContext,
  key: string | undefined,
  value: string,
  force: boolean
): Promise<void> {
  if (!key || !value) {
    throw new Error("Usage: devtun config set <key> <value> [--force]");
  }
  if (!configExists(inst.dir)) {
    throw new Error('No config found. Run "devtun setup" first.');
  }
  if (!VALID_KEYS.includes(key as ValidKey)) {
    throw new Error(
      `Unknown config key: ${key}\nValid keys: ${VALID_KEYS.join(", ")}`
    );
  }

  const cfg = loadConfig(inst.dir);

  switch (key as ValidKey) {
    case "domain":
      await setDomain(inst, cfg, value, force);
      return;
    case "devSubdomain":
      await setDevSubdomain(inst, cfg, value, force);
      return;
    case "tunnelName":
      setTunnelName(inst, cfg, value);
      return;
    case "cfTokenSource":
      cfg.cfTokenSource = value;
      saveConfig(inst.dir, cfg);
      out.success(`Set cfTokenSource = ${value}`);
      return;
    case "dockerSocket":
      setDockerSocket(inst, cfg, value);
      return;
    case "publishHttpPort":
      setPort(inst, cfg, "publishHttpPort", value);
      return;
    case "dashboardPort":
      setPort(inst, cfg, "dashboardPort", value);
      return;
  }
}

function setDockerSocket(
  inst: InstanceContext,
  cfg: DevtunnelConfig,
  value: string
): void {
  if (!value.startsWith("/")) {
    throw new Error(`dockerSocket must be an absolute path, got: ${value}`);
  }
  cfg.dockerSocket = value;
  saveConfig(inst.dir, cfg);
  out.success(`Set dockerSocket = ${value}`);
  out.info(`Run \`devtun up${inst.isDefault ? "" : ` -i ${inst.name}`}\` to apply.`);
}

function setPort(
  inst: InstanceContext,
  cfg: DevtunnelConfig,
  key: "publishHttpPort" | "dashboardPort",
  value: string
): void {
  if (value === "off" || value === "false") {
    delete cfg[key];
    saveConfig(inst.dir, cfg);
    out.success(`Set ${key} = off`);
  } else {
    const port = parseInt(value, 10);
    if (isNaN(port) || port <= 0 || port > 65535 || String(port) !== value) {
      throw new Error(`Invalid ${key}: ${value}. Expected a port number (1-65535) or 'off'.`);
    }
    cfg[key] = port;
    saveConfig(inst.dir, cfg);
    out.success(`Set ${key} = ${port}`);
  }
  out.info(`Run \`devtun up${inst.isDefault ? "" : ` -i ${inst.name}`}\` to apply.`);
}

async function setDomain(
  inst: InstanceContext,
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
  saveConfig(inst.dir, cfg);

  out.blank();
  out.success(`domain: ${oldDomain} -> ${newDomain}`);
  out.info("Cleared cached zoneId, accountId, tunnelId, tunnelToken.");
  out.info("Run `devtun setup` to provision the new zone.");
}

async function setDevSubdomain(
  inst: InstanceContext,
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
  saveConfig(inst.dir, cfg);

  out.blank();
  out.success(`devSubdomain: ${oldSubdomain} -> ${newSubdomain}`);
  out.info(
    `Run \`devtun setup\` to reconfigure tunnel ingress for *.${newSubdomain}.`
  );
}

function setTunnelName(
  inst: InstanceContext,
  cfg: DevtunnelConfig,
  newName: string
): void {
  if (cfg.tunnelName === newName) {
    out.info(`tunnelName is already ${newName}. No change.`);
    return;
  }

  const oldName = cfg.tunnelName;
  const oldId = cfg.tunnelId;
  cfg.tunnelName = newName;
  delete cfg.tunnelId;
  delete cfg.tunnelToken;
  saveConfig(inst.dir, cfg);

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

function get(inst: InstanceContext, key: string | undefined, asJson: boolean): void {
  if (!key) {
    throw new Error("Usage: devtun config get <key> [--json]");
  }
  if (key === "tunnelToken") {
    throw new Error("tunnelToken is sensitive and cannot be read via `config get`.");
  }
  const cfg = loadConfig(inst.dir);
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

function list(inst: InstanceContext, asJson: boolean): void {
  if (!configExists(inst.dir)) {
    throw new Error('No config found. Run "devtun setup" first.');
  }
  const cfg = loadConfig(inst.dir);

  if (asJson) {
    out.setJsonMode(true);
    // Never include tunnelToken in JSON output.
    const { tunnelToken: _omit, ...safe } = cfg;
    void _omit;
    out.json(safe);
    return;
  }

  out.header(inst.isDefault ? "devtun config" : `devtun config (instance: ${inst.name})`);
  out.info(`domain:          ${cfg.domain}`);
  out.info(`devSubdomain:    ${cfg.devSubdomain}`);
  out.info(`tunnelName:      ${cfg.tunnelName}`);
  out.info(`cfTokenSource:   ${cfg.cfTokenSource ?? "(not set - using env var)"}`);
  out.info(`tunnelId:        ${cfg.tunnelId ?? "(not set)"}`);
  out.info(`zoneId:          ${cfg.zoneId ?? "(not set)"}`);
  out.info(`accountId:       ${cfg.accountId ?? "(not set)"}`);
  out.info(`dockerSocket:    ${cfg.dockerSocket ?? "(default: /var/run/docker.sock)"}`);
  out.info(`publishHttpPort: ${cfg.publishHttpPort || "off"}`);
  out.info(`dashboardPort:   ${cfg.dashboardPort || "off"}`);
  out.info(`extraFqdns:      ${cfg.extraFqdns?.length ? cfg.extraFqdns.join(", ") : "(none)"}`);
  out.blank();
  out.dim(`${inst.dir}/config.json`);
  out.blank();
}
