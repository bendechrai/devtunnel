import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import { validateProjectName } from "../lib/validate.js";
import {
  addOverrideLabels,
  detectServiceAndPort,
} from "../lib/compose.js";
import { ask, confirm } from "../lib/prompt.js";
import { restartProject } from "../lib/docker.js";

export async function add(name?: string): Promise<void> {
  if (!name) {
    throw new Error("Usage: devtun add <name>");
  }
  validateProjectName(name);

  const config = loadConfig();
  const token = resolveToken(config);
  cf.setToken(token);

  const hostname = `${name}.${config.devSubdomain}`;
  const zoneId = config.zoneId!;
  const fallbackHost = `tunnel-origin.${config.domain}`;

  out.header(`Adding ${hostname}`);

  // --- Cloudflare: DNS + Custom Hostname ---
  out.step(1, "Cloudflare DNS...");

  const existingCh = await cf.findCustomHostname(zoneId, hostname);
  if (existingCh) {
    out.info(`Custom hostname already registered (${existingCh.status})`);
    out.info(`SSL: ${existingCh.ssl.status}`);
  } else {
    // DNS record
    const dnsRecord = await cf.findDnsRecord(zoneId, hostname, "CNAME");
    if (dnsRecord) {
      out.info("DNS record exists.");
    } else {
      out.info(`Creating DNS: ${hostname} -> ${fallbackHost}`);
      await cf.createDnsRecord(zoneId, {
        type: "CNAME",
        name: hostname,
        content: fallbackHost,
        proxied: true,
      });
    }

    // Custom hostname
    out.info("Registering custom hostname with SSL...");
    const ch = await cf.createCustomHostname(zoneId, hostname);
    out.success(`Registered (SSL: ${ch.ssl.status})`);

    // Ownership verification TXT record
    if (ch.ownership_verification?.type === "txt") {
      out.info("Adding ownership verification TXT record...");
      try {
        await cf.createDnsRecord(zoneId, {
          type: "TXT",
          name: ch.ownership_verification.name,
          content: ch.ownership_verification.value,
          proxied: false,
        });
      } catch {
        out.warn("Could not create TXT record automatically.");
        out.info(
          `  ${ch.ownership_verification.name} TXT ${ch.ownership_verification.value}`
        );
      }
    }
  }
  out.blank();

  // --- Docker Compose Override ---
  out.step(2, "Docker Compose override...");

  const projectDir = process.cwd();
  const detected = detectServiceAndPort(projectDir);

  let serviceName: string;
  let port: number;

  if (detected) {
    out.info(`Detected service: ${detected.serviceName} (port ${detected.port})`);
    const useDetected = await confirm("Use these settings?");
    if (useDetected) {
      serviceName = detected.serviceName;
      port = detected.port;
    } else {
      serviceName = await ask("Service name: ");
      port = parseInt(await ask("Container port: "), 10);
    }
  } else {
    out.info("No docker-compose.yml found in current directory.");
    serviceName = await ask("Service name: ");
    port = parseInt(await ask("Container port: "), 10);
  }

  addOverrideLabels({
    projectDir,
    serviceName,
    hostname,
    routerName: name,
    port,
  });
  out.success("Updated docker-compose.override.yml");
  out.blank();

  // --- Offer to restart ---
  const shouldRestart = await confirm(
    "Restart containers to apply changes? (docker compose up -d)"
  );
  if (shouldRestart) {
    restartProject(projectDir);
  } else {
    out.info("Run this when ready:");
    out.info("  docker compose up -d");
  }
  out.blank();

  out.success(`https://${hostname}/ will be live once SSL activates.`);
  out.info("Check status with: devtun status " + name);
  out.blank();
}
