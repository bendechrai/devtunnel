import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { configExists, loadConfig, saveConfig, writeEnvFile } from "../lib/config.js";
import { writeInfraCompose } from "../lib/compose.js";
import { resolveToken } from "../lib/token.js";
import { isDockerRunning, composeUp } from "../lib/docker.js";
import { ask, confirm, isInteractive, waitForEnter } from "../lib/prompt.js";
import { parseFlags } from "../lib/flags.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";
import type { DevtunnelConfig } from "../lib/types.js";

const setupHelp: HelpDoc = {
  command: "setup",
  synopsis:
    "devtun setup [--domain=<zone>] [--dev-subdomain=<sub>] [--tunnel-name=<name>]\n              [--cf-token-source=<source>] [--yes] [--help]",
  description:
    "One-time infrastructure setup. Idempotent: re-run safely after fixing an issue. Walks through:\nconfig, Docker check, Cloudflare zone, tunnel, SSL settings, Cloudflare for SaaS + fallback origin,\nthen starts the local Traefik + cloudflared stack.\n\nIf ~/.devtun/config.json doesn't exist yet, values come from flags > env vars > interactive prompts.\nIn a non-TTY context (CI, automation), all four values must be provided via flags or env.\nIf Cloudflare for SaaS needs to be enabled in the dashboard, the command pauses (TTY) or exits\nwith code 2 (non-TTY) with the dashboard URL.",
  flags: [
    { name: "domain", type: "string", description: "Root domain (matches a Cloudflare zone on your account)." },
    { name: "dev-subdomain", type: "string", description: "Wildcard subdomain for projects, e.g. dev.example.com." },
    { name: "tunnel-name", type: "string", description: "Cloudflare Tunnel name. Defaults to dev-<dashified-domain>." },
    { name: "cf-token-source", type: "string", description: "1Password reference (op://...) or literal token. Stored in config." },
    { name: "yes", aliases: ["y"], description: "Auto-confirm destructive prompts (e.g., recreating a locally-managed tunnel)." },
    { name: "help", aliases: ["h"], description: "Show this help" },
  ],
  env: [
    { name: "CLOUDFLARE_API_TOKEN", description: "Cloudflare API token. Takes precedence over cfTokenSource." },
    { name: "DEVTUN_DOMAIN", description: "Same as --domain. Used when --domain isn't passed." },
    { name: "DEVTUN_DEV_SUBDOMAIN", description: "Same as --dev-subdomain." },
    { name: "DEVTUN_TUNNEL_NAME", description: "Same as --tunnel-name." },
  ],
  exits: [
    { code: 0, meaning: "Setup completed (stack up)" },
    { code: 1, meaning: "Configuration error, Docker missing, or Cloudflare API failure" },
    { code: 2, meaning: "Cloudflare for SaaS needs to be enabled manually in the dashboard (non-TTY only)" },
  ],
  examples: [
    { description: "First-time interactive setup", command: "devtun setup" },
    { description: "Unattended setup with all values", command: "CLOUDFLARE_API_TOKEN=... devtun setup --domain example.com --dev-subdomain dev.example.com --yes" },
    { description: "Re-run after fixing an issue (idempotent)", command: "devtun setup" },
  ],
};

export async function setup(args: string[] = []): Promise<void> {
  if (handleHelp(args, setupHelp)) return;

  const { flags } = parseFlags(args, {
    string: ["domain", "dev-subdomain", "tunnel-name", "cf-token-source"],
    boolean: ["yes"],
    aliases: { y: "yes" },
  });
  const autoYes = flags["yes"] === true;

  out.header("devtun setup");

  // --- Step 1: Config ---
  let config: DevtunnelConfig;

  if (configExists()) {
    config = loadConfig();
    out.step(1, "Configuration");
    out.info(`Domain: ${config.domain}`);
    out.info(`Dev subdomain: *.${config.devSubdomain}`);
    out.info(`Tunnel: ${config.tunnelName}`);
  } else {
    out.step(1, "Configuration");
    out.info("No config found. Let's set one up.");
    out.blank();

    const domain = await resolveValue(
      "domain",
      flags["domain"],
      process.env["DEVTUN_DOMAIN"],
      "Root domain (Cloudflare zone): "
    );
    const defaultDev = `dev.${domain}`;
    const devSubdomain =
      (await resolveValue(
        "dev-subdomain",
        flags["dev-subdomain"],
        process.env["DEVTUN_DEV_SUBDOMAIN"],
        `Dev subdomain [${defaultDev}]: `,
        { defaultValue: defaultDev }
      )) || defaultDev;
    const defaultTunnel = `dev-${domain.replace(/\./g, "-")}`;
    const tunnelName =
      (await resolveValue(
        "tunnel-name",
        flags["tunnel-name"],
        process.env["DEVTUN_TUNNEL_NAME"],
        `Tunnel name [${defaultTunnel}]: `,
        { defaultValue: defaultTunnel }
      )) || defaultTunnel;
    const cfTokenSource = await resolveValue(
      "cf-token-source",
      flags["cf-token-source"],
      undefined,
      "Cloudflare API token (or op:// reference, or leave empty for env var): ",
      { defaultValue: "" }
    );

    config = { domain, devSubdomain, tunnelName };
    if (cfTokenSource) config.cfTokenSource = cfTokenSource;
    saveConfig(config);
    out.success("Config saved to ~/.devtun/config.json");
  }
  out.blank();

  // --- Step 2: Prerequisites ---
  out.step(2, "Checking prerequisites...");
  if (!isDockerRunning()) {
    throw new Error("Docker is not running. Start Docker and try again.");
  }
  out.info("Docker: running");

  const token = resolveToken(config);
  cf.setToken(token);
  out.info("Cloudflare API token: resolved");
  out.blank();

  // --- Step 3: Zone lookup ---
  out.step(3, "Looking up zone...");
  if (!config.zoneId || !config.accountId) {
    const zone = await cf.getZone(config.domain);
    config.zoneId = zone.zoneId;
    config.accountId = zone.accountId;
    saveConfig(config);
  }
  out.info(`Zone ID: ${config.zoneId}`);
  out.info(`Account ID: ${config.accountId}`);
  out.blank();

  // --- Step 4: Tunnel ---
  out.step(4, "Cloudflare Tunnel...");
  const accountId = config.accountId!;

  if (!config.tunnelId) {
    const existing = await cf.findTunnel(accountId, config.tunnelName);
    if (existing) {
      config.tunnelId = existing.id;
      out.info(`Tunnel '${config.tunnelName}' exists (${existing.id})`);
    } else {
      out.info(`Creating tunnel '${config.tunnelName}'...`);
      const tunnel = await cf.createTunnel(accountId, config.tunnelName);
      config.tunnelId = tunnel.id;
      out.success(`Created (${tunnel.id})`);
    }
    saveConfig(config);
  } else {
    out.info(`Tunnel: ${config.tunnelName} (${config.tunnelId})`);
  }

  // Get tunnel token (may fail for locally-managed tunnels)
  let tunnelToken: string;
  try {
    tunnelToken = await cf.getTunnelToken(accountId, config.tunnelId!);
  } catch {
    out.blank();
    out.warn("Could not get tunnel token.");
    out.info("The existing tunnel was created by cloudflared CLI (locally-managed).");
    out.info("devtun needs a remotely-managed tunnel to work without credential files.");
    out.blank();
    out.info("To fix this:");
    out.info("  1. Stop the existing tunnel: docker compose down (in the old project)");
    out.info(`  2. Delete it: cloudflared tunnel delete ${config.tunnelName}`);
    out.info("  3. Run devtun setup again to create a new remotely-managed tunnel");
    out.blank();

    const shouldRecreate = autoYes
      ? true
      : await confirm(
          "Or: delete the existing tunnel and create a new one now?",
          { defaultWhenNonInteractive: false }
        );
    if (!shouldRecreate) {
      process.exit(1);
    }

    try {
      await cf.deleteTunnel(accountId, config.tunnelId!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("active connections")) {
        out.blank();
        out.error("The tunnel has active connections.");
        out.info("Stop the existing tunnel first, then try again:");
        out.info("  docker compose down  (in the old project directory)");
        process.exit(1);
      }
      throw e;
    }

    const newTunnel = await cf.createTunnel(accountId, config.tunnelName);
    config.tunnelId = newTunnel.id;
    saveConfig(config);
    out.success(`Created new tunnel (${newTunnel.id})`);
    tunnelToken = await cf.getTunnelToken(accountId, config.tunnelId!);
  }
  config.tunnelToken = tunnelToken;
  saveConfig(config);
  out.info("Tunnel token: retrieved");

  // Configure tunnel ingress
  out.info("Configuring ingress rules...");
  await cf.configureTunnel(accountId, config.tunnelId!, config.devSubdomain);
  out.success(`Ingress: *.${config.devSubdomain} -> traefik`);
  out.blank();

  // --- Step 5: SSL ---
  out.step(5, "SSL configuration...");
  const zoneId = config.zoneId!;

  const sslMode = await cf.getSslMode(zoneId);
  if (sslMode !== "full") {
    await cf.setSslMode(zoneId, "full");
    out.info("SSL mode: updated to full");
  } else {
    out.info("SSL mode: full");
  }

  const universalSsl = await cf.getUniversalSsl(zoneId);
  if (!universalSsl) {
    await cf.setUniversalSsl(zoneId, true);
    out.info("Universal SSL: enabled");
  } else {
    out.info("Universal SSL: enabled");
  }
  out.blank();

  // --- Step 6: Cloudflare for SaaS ---
  out.step(6, "Cloudflare for SaaS...");

  const saasEnabled = await cf.isSaasEnabled(zoneId);
  if (!saasEnabled) {
    out.warn("Cloudflare for SaaS is not enabled.");
    out.info("Enable it (free) in the Cloudflare dashboard:");
    out.url(
      `https://dash.cloudflare.com/${accountId}/${config.domain}/ssl-tls/custom-hostnames`
    );

    if (!isInteractive()) {
      out.blank();
      out.error(
        "Cannot wait for manual dashboard step in a non-interactive context."
      );
      out.info("Enable Cloudflare for SaaS in the dashboard, then re-run `devtun setup`.");
      process.exit(2);
    }

    await waitForEnter("");

    const retryEnabled = await cf.isSaasEnabled(zoneId);
    if (!retryEnabled) {
      throw new Error("Cloudflare for SaaS still not enabled. Try again.");
    }
  }
  out.info("SaaS: enabled");

  // Fallback origin
  const fallbackHost = `tunnel-origin.${config.domain}`;
  const tunnelCname = `${config.tunnelId}.cfargotunnel.com`;

  const existingRecord = await cf.findDnsRecord(zoneId, fallbackHost);
  if (existingRecord) {
    if (existingRecord.type !== "CNAME" || existingRecord.content !== tunnelCname) {
      out.info(`Updating fallback DNS to CNAME -> tunnel...`);
      await cf.updateDnsRecord(zoneId, existingRecord.id, {
        type: "CNAME",
        name: fallbackHost,
        content: tunnelCname,
        proxied: true,
      });
    } else {
      out.info(`Fallback DNS: ${fallbackHost} -> tunnel`);
    }
  } else {
    out.info(`Creating fallback DNS: ${fallbackHost} -> tunnel...`);
    await cf.createDnsRecord(zoneId, {
      type: "CNAME",
      name: fallbackHost,
      content: tunnelCname,
      proxied: true,
    });
  }

  const fallback = await cf.getFallbackOrigin(zoneId);
  if (!fallback || fallback.origin !== fallbackHost) {
    out.info(`Setting fallback origin to ${fallbackHost}...`);
    const result = await cf.setFallbackOrigin(zoneId, fallbackHost);
    if (result.status !== "active") {
      out.info("Waiting for fallback origin to activate...");
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const check = await cf.getFallbackOrigin(zoneId);
        if (check?.status === "active") break;
      }
    }
  }
  out.info(`Fallback origin: ${fallbackHost} (active)`);
  out.blank();

  // --- Step 7: Generate compose and start ---
  out.step(7, "Starting services...");
  writeInfraCompose();
  writeEnvFile({ TUNNEL_TOKEN: tunnelToken });
  out.info("Generated ~/.devtun/docker-compose.yml");

  composeUp();
  out.blank();

  // --- Done ---
  out.header("Setup complete!");
  out.info("Register a project:");
  out.info("  devtun add <name>");
  out.blank();
  out.info("Traefik dashboard: http://localhost:8080");
  out.blank();
}

interface ResolveValueOpts {
  defaultValue?: string;
}

/**
 * Resolve a value from flag > env > prompt (if TTY) > default (if any).
 * Throws in a non-TTY context when no value source is available, naming the
 * flag and env var the user should set.
 */
async function resolveValue(
  flagName: string,
  flagValue: string | boolean | undefined,
  envValue: string | undefined,
  promptText: string,
  opts: ResolveValueOpts = {}
): Promise<string> {
  if (typeof flagValue === "string" && flagValue) return flagValue;
  if (envValue) return envValue;
  if (isInteractive()) {
    const answer = await ask(promptText);
    if (answer) return answer;
    if (opts.defaultValue !== undefined) return opts.defaultValue;
  }
  if (opts.defaultValue !== undefined) return opts.defaultValue;
  const envName = `DEVTUN_${flagName.replace(/-/g, "_").toUpperCase()}`;
  throw new Error(
    `Missing required value '${flagName}' in non-interactive mode. ` +
    `Pass --${flagName}=<value> or set ${envName}.`
  );
}
