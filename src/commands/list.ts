import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import { readOverrideMappings } from "../lib/compose.js";

export async function list(): Promise<void> {
  const config = loadConfig();
  const token = resolveToken(config);
  cf.setToken(token);

  const zoneId = config.zoneId!;
  const hostnames = await cf.listCustomHostnames(zoneId);

  out.header("Registered projects");

  if (hostnames.length === 0) {
    out.info("(none)");
    out.blank();
    out.info("Add one with: devtun add <name> <service> <port>");
    out.blank();
    return;
  }

  // Build a lookup from router name to local override mapping
  const mappings = readOverrideMappings(process.cwd());
  const mappingByHostname = new Map(
    mappings.map((m) => [`${m.routerName}.${config.devSubdomain}`, m])
  );

  out.table(
    hostnames.map((h) => {
      const mapping = mappingByHostname.get(h.hostname);
      return {
        hostname: h.hostname,
        service: mapping ? `${mapping.serviceName}:${mapping.port}` : "-",
        status: h.status,
        ssl: h.ssl.status,
      };
    }),
    ["hostname", "service", "status", "ssl"]
  );
  out.blank();
  out.info(`Total: ${hostnames.length}`);
  out.blank();
}
