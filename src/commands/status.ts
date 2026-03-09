import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import { validateProjectName } from "../lib/validate.js";

export async function status(name?: string): Promise<void> {
  const config = loadConfig();
  const token = resolveToken(config);
  cf.setToken(token);

  const zoneId = config.zoneId!;

  if (name) {
    validateProjectName(name);
    const hostname = `${name}.${config.devSubdomain}`;
    const ch = await cf.findCustomHostname(zoneId, hostname);

    if (!ch) {
      out.error(`${hostname} is not registered.`);
      out.info("Add it with: devtun add " + name);
      process.exit(1);
      return;
    }

    out.header(hostname);
    out.info(`Status:     ${ch.status}`);
    out.info(`SSL status: ${ch.ssl.status}`);
    out.info(`SSL method: ${ch.ssl.method}`);
    out.info(`Created:    ${ch.created_at}`);

    if (ch.status === "pending" && ch.ownership_verification) {
      out.blank();
      out.warn("Ownership verification needed:");
      out.info(
        `  ${ch.ownership_verification.type} record: ${ch.ownership_verification.name} -> ${ch.ownership_verification.value}`
      );
    }

    if (ch.ssl.status === "active" && ch.status === "active") {
      out.blank();
      out.success(`https://${hostname}/ is live`);
    }
  } else {
    // Show overall infrastructure status
    out.header("devtun status");

    out.info(`Domain:        ${config.domain}`);
    out.info(`Dev subdomain: *.${config.devSubdomain}`);
    out.info(`Tunnel:        ${config.tunnelName} (${config.tunnelId ?? "not created"})`);
    out.info(`Zone ID:       ${config.zoneId ?? "not resolved"}`);

    const fallback = await cf.getFallbackOrigin(zoneId);
    out.info(
      `Fallback:      ${fallback ? `${fallback.origin} (${fallback.status})` : "not configured"}`
    );

    out.blank();
    const hostnames = await cf.listCustomHostnames(zoneId);
    out.info(`Projects: ${hostnames.length} registered`);
    if (hostnames.length > 0) {
      out.table(
        hostnames.map((h) => ({
          hostname: h.hostname,
          status: h.status,
          ssl: h.ssl.status,
        })),
        ["hostname", "status", "ssl"]
      );
    }
  }
  out.blank();
}
