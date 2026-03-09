import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { configExists, loadConfig, saveConfig, writeEnvFile } from "../lib/config.js";
import { writeInfraCompose } from "../lib/compose.js";
import { resolveToken } from "../lib/token.js";
import { isDockerRunning, composeUp } from "../lib/docker.js";
import { ask, confirm, waitForEnter } from "../lib/prompt.js";
import type { DevtunnelConfig } from "../lib/types.js";

export async function setup(): Promise<void> {
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

    const domain = await ask("Root domain (Cloudflare zone): ");
    const devSubdomain = await ask(`Dev subdomain [dev.${domain}]: `) || `dev.${domain}`;
    const tunnelName = await ask(`Tunnel name [dev-${domain.replace(/\./g, "-")}]: `) || `dev-${domain.replace(/\./g, "-")}`;
    const cfTokenSource = await ask("Cloudflare API token (or op:// reference, or leave empty for env var): ");

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

    const shouldRecreate = await confirm(
      "Or: delete the existing tunnel and create a new one now?"
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
