import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";

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
    out.info("Add one with: devtun add <name>");
    out.blank();
    return;
  }

  out.table(
    hostnames.map((h) => ({
      hostname: h.hostname,
      status: h.status,
      ssl: h.ssl.status,
    })),
    ["hostname", "status", "ssl"]
  );
  out.blank();
  out.info(`Total: ${hostnames.length}`);
  out.blank();
}
