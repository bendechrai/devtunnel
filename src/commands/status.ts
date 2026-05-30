import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import { validateProjectName } from "../lib/validate.js";
import { parseFlags } from "../lib/flags.js";

export async function status(args: string[] = []): Promise<void> {
  const { positional, flags } = parseFlags(args, { boolean: ["json"] });
  const asJson = flags["json"] === true;
  if (asJson) out.setJsonMode(true);

  const name = positional[0];

  const config = loadConfig();
  const token = resolveToken(config);
  cf.setToken(token);

  const zoneId = config.zoneId!;

  if (name) {
    validateProjectName(name);
    const hostname = `${name}.${config.devSubdomain}`;
    const ch = await cf.findCustomHostname(zoneId, hostname);

    if (!ch) {
      if (asJson) {
        out.json({ hostname, registered: false });
      } else {
        out.error(`${hostname} is not registered.`);
        out.info("Add it with: devtun add " + name);
      }
      process.exit(1);
      return;
    }

    if (asJson) {
      out.json({
        hostname: ch.hostname,
        registered: true,
        status: ch.status,
        ssl: {
          status: ch.ssl.status,
          method: ch.ssl.method,
        },
        createdAt: ch.created_at,
        ...(ch.ownership_verification && {
          ownershipVerification: {
            type: ch.ownership_verification.type,
            name: ch.ownership_verification.name,
            value: ch.ownership_verification.value,
          },
        }),
      });
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
    out.blank();
    return;
  }

  // No name: infrastructure status
  const fallback = await cf.getFallbackOrigin(zoneId);
  const hostnames = await cf.listCustomHostnames(zoneId);

  if (asJson) {
    out.json({
      domain: config.domain,
      devSubdomain: config.devSubdomain,
      tunnel: {
        name: config.tunnelName,
        id: config.tunnelId ?? null,
      },
      zoneId: config.zoneId ?? null,
      accountId: config.accountId ?? null,
      fallback: fallback
        ? { origin: fallback.origin, status: fallback.status }
        : null,
      projects: hostnames.map((h) => ({
        hostname: h.hostname,
        status: h.status,
        ssl: h.ssl.status,
      })),
    });
    return;
  }

  out.header("devtun status");

  out.info(`Domain:        ${config.domain}`);
  out.info(`Dev subdomain: *.${config.devSubdomain}`);
  out.info(`Tunnel:        ${config.tunnelName} (${config.tunnelId ?? "not created"})`);
  out.info(`Zone ID:       ${config.zoneId ?? "not resolved"}`);
  out.info(
    `Fallback:      ${fallback ? `${fallback.origin} (${fallback.status})` : "not configured"}`
  );

  out.blank();
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
  out.blank();
}
