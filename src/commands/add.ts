import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import { validateProjectName } from "../lib/validate.js";
import { addOverrideLabels } from "../lib/compose.js";
import { confirm } from "../lib/prompt.js";
import { restartProject } from "../lib/docker.js";
import { parseFlags } from "../lib/flags.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";

const addHelp: HelpDoc = {
  command: "add",
  synopsis: "devtun add <name> <service> <port> [--restart|--no-restart|--yes] [--help]",
  description:
    "Register a project hostname. Creates a Cloudflare DNS record + custom hostname (with edge SSL cert),\nand writes Traefik routing labels into the project's docker-compose.override.yml.\nRun from the project directory.",
  args: [
    { name: "name", required: true, description: "Project name. Becomes the subdomain: <name>.<devSubdomain>. Lowercase letters, digits, hyphens; max 63 chars." },
    { name: "service", required: true, description: "Service name in the project's docker-compose to route to." },
    { name: "port", required: true, description: "Port the service listens on inside the container." },
  ],
  flags: [
    { name: "restart", description: "Run `docker compose up -d` after writing the override file. Never prompts." },
    { name: "no-restart", description: "Skip the container restart. Never prompts." },
    { name: "yes", aliases: ["y"], description: "Equivalent to --restart." },
    { name: "help", aliases: ["h"], description: "Show this help" },
  ],
  env: [
    { name: "CLOUDFLARE_API_TOKEN", description: "Cloudflare API token with Zone Settings:Edit, SSL:Edit, DNS:Edit on the target zone." },
  ],
  exits: [
    { code: 0, meaning: "Hostname registered and override file written" },
    { code: 1, meaning: "Validation error, config missing, or Cloudflare API failure" },
  ],
  examples: [
    { description: "Register myapp routing to the web service on port 3000", command: "devtun add myapp web 3000" },
    { description: "Same, but restart containers automatically (CI-friendly)", command: "devtun add myapp web 3000 --restart" },
    { description: "Same, but explicitly skip the restart (CI-friendly)", command: "devtun add myapp web 3000 --no-restart" },
  ],
};

export async function add(args: string[] = []): Promise<void> {
  if (handleHelp(args, addHelp)) return;
  const { positional, flags } = parseFlags(args, {
    boolean: ["yes", "restart"],
    aliases: { y: "yes" },
  });

  const [name, service, portArg] = positional;
  if (!name || !service || !portArg) {
    throw new Error(
      "Usage: devtun add <name> <service> <port> [--yes|--restart|--no-restart]"
    );
  }
  validateProjectName(name);

  const port = parseInt(portArg, 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${portArg}`);
  }

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

    out.info("Registering custom hostname with SSL...");
    const ch = await cf.createCustomHostname(zoneId, hostname);
    out.success(`Registered (SSL: ${ch.ssl.status})`);

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
  addOverrideLabels({
    projectDir,
    serviceName: service,
    hostname,
    routerName: name,
    port,
  });
  out.success(`Updated docker-compose.override.yml (${service}:${port})`);
  out.blank();

  // --- Restart decision ---
  const shouldRestart = await resolveRestart(flags);

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

async function resolveRestart(
  flags: Record<string, string | boolean>
): Promise<boolean> {
  if (typeof flags["restart"] === "boolean") return flags["restart"];
  if (flags["yes"] === true) return true;
  return confirm("Restart containers to apply changes? (docker compose up -d)", {
    defaultWhenNonInteractive: false,
  });
}
