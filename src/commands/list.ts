import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import { readOverrideMappings } from "../lib/compose.js";
import { parseFlags } from "../lib/flags.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";

const listHelp: HelpDoc = {
  command: "list",
  synopsis: "devtun list [--json] [--help]",
  description:
    "List all hostnames registered on the current Cloudflare zone. When run from a project directory,\nthe `service` column shows the local Traefik mapping (service:port) for hostnames whose router\nname matches the local override file.",
  flags: [
    {
      name: "json",
      description:
        "Emit an array of { hostname, service, port, status, ssl }. service and port are null when no local mapping is found.",
    },
    { name: "help", aliases: ["h"], description: "Show this help" },
  ],
  env: [
    { name: "CLOUDFLARE_API_TOKEN", description: "Cloudflare API token." },
  ],
  exits: [
    { code: 0, meaning: "Success" },
    { code: 1, meaning: "Config missing or Cloudflare API failure" },
  ],
  examples: [
    { description: "List all projects (human format)", command: "devtun list" },
    { description: "List as JSON for scripting", command: "devtun list --json" },
    { description: "Just the hostnames", command: "devtun list --json | jq -r '.[].hostname'" },
  ],
};

export async function list(args: string[] = []): Promise<void> {
  if (handleHelp(args, listHelp)) return;
  const { flags } = parseFlags(args, { boolean: ["json"] });
  const asJson = flags["json"] === true;
  if (asJson) out.setJsonMode(true);

  const config = loadConfig();
  const token = resolveToken(config);
  cf.setToken(token);

  const zoneId = config.zoneId!;
  const hostnames = await cf.listCustomHostnames(zoneId);

  const mappings = readOverrideMappings(process.cwd());
  const mappingByHostname = new Map(
    mappings.map((m) => [`${m.routerName}.${config.devSubdomain}`, m])
  );

  if (asJson) {
    out.json(
      hostnames.map((h) => {
        const mapping = mappingByHostname.get(h.hostname);
        return {
          hostname: h.hostname,
          service: mapping?.serviceName ?? null,
          port: mapping?.port ?? null,
          status: h.status,
          ssl: h.ssl.status,
        };
      })
    );
    return;
  }

  out.header("Registered projects");

  if (hostnames.length === 0) {
    out.info("(none)");
    out.blank();
    out.info("Add one with: devtun add <name> <service> <port>");
    out.blank();
    return;
  }

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
