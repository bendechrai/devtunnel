import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import { validateProjectName } from "../lib/validate.js";
import { removeOverrideLabels } from "../lib/compose.js";
import { confirm } from "../lib/prompt.js";
import { restartProject } from "../lib/docker.js";
import { parseFlags } from "../lib/flags.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";

const removeHelp: HelpDoc = {
  command: "remove",
  synopsis: "devtun remove <name> [--restart|--no-restart|--yes] [--help]",
  description:
    "Remove a project hostname. Deletes the Cloudflare custom hostname, DNS record, and TXT verification\nrecord (if present), and strips the Traefik labels from the project's docker-compose.override.yml.\nRun from the project directory so the local file is cleaned up.",
  args: [
    { name: "name", required: true, description: "Project name (the same one used with `devtun add`)." },
  ],
  flags: [
    { name: "restart", description: "Run `docker compose up -d` after cleaning the override file. Never prompts." },
    { name: "no-restart", description: "Skip the container restart. Never prompts." },
    { name: "yes", aliases: ["y"], description: "Equivalent to --restart." },
    { name: "help", aliases: ["h"], description: "Show this help" },
  ],
  env: [
    { name: "CLOUDFLARE_API_TOKEN", description: "Cloudflare API token with Zone Settings:Edit, SSL:Edit, DNS:Edit on the target zone." },
  ],
  exits: [
    { code: 0, meaning: "Hostname removed (no-op if already gone)" },
    { code: 1, meaning: "Validation error, config missing, or Cloudflare API failure" },
  ],
  examples: [
    { description: "Remove myapp", command: "devtun remove myapp" },
    { description: "Remove and restart (CI-friendly)", command: "devtun remove myapp --restart" },
  ],
};

export async function remove(args: string[] = []): Promise<void> {
  if (handleHelp(args, removeHelp)) return;
  const { positional, flags } = parseFlags(args, {
    boolean: ["yes", "restart"],
    aliases: { y: "yes" },
  });

  const [name] = positional;
  if (!name) {
    throw new Error(
      "Usage: devtun remove <name> [--yes|--restart|--no-restart]"
    );
  }
  validateProjectName(name);

  const config = loadConfig();
  const token = resolveToken(config);
  cf.setToken(token);

  const hostname = `${name}.${config.devSubdomain}`;
  const zoneId = config.zoneId!;

  out.header(`Removing ${hostname}`);

  // --- Custom hostname ---
  const ch = await cf.findCustomHostname(zoneId, hostname);
  if (ch) {
    await cf.deleteCustomHostname(zoneId, ch.id);
    out.info("Custom hostname removed.");
  } else {
    out.info("No custom hostname found.");
  }

  // --- DNS records ---
  const dnsRecord = await cf.findDnsRecord(zoneId, hostname);
  if (dnsRecord) {
    await cf.deleteDnsRecord(zoneId, dnsRecord.id);
    out.info("DNS record removed.");
  }

  const txtRecord = await cf.findDnsRecord(
    zoneId,
    `_cf-custom-hostname.${hostname}`,
    "TXT"
  );
  if (txtRecord) {
    await cf.deleteDnsRecord(zoneId, txtRecord.id);
    out.info("Verification TXT record removed.");
  }

  // --- Override file ---
  const projectDir = process.cwd();
  removeOverrideLabels(projectDir, name);
  out.info("Cleaned docker-compose.override.yml");
  out.blank();

  const shouldRestart = await resolveRestart(flags);
  if (shouldRestart) {
    restartProject(projectDir);
  }

  out.blank();
  out.success(`${hostname} removed.`);
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
