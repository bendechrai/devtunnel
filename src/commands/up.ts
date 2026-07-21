import * as out from "../lib/output.js";
import { loadConfig, writeEnvFile, dockerSocketOf } from "../lib/config.js";
import { writeInfraCompose, checkComposeSocketDrift } from "../lib/compose.js";
import { composeUp } from "../lib/docker.js";
import { resolveInstance } from "../lib/instance.js";
import { parseFlags } from "../lib/flags.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";

const upHelp: HelpDoc = {
  command: "up",
  synopsis: "devtun up [--instance <name>] [--help]",
  description:
    "Start the devtun infrastructure containers (Traefik + cloudflared) using Docker Compose.\nRegenerates the instance's docker-compose.yml and .env from config every run.\nRefuses to regenerate if the compose file's Docker socket mount disagrees with config\n(fix with `devtun config set dockerSocket <path>`).",
  flags: [
    { name: "instance", aliases: ["i"], type: "string", description: "Target instance. Defaults to DEVTUN_INSTANCE or 'devtun'." },
    { name: "help", aliases: ["h"], description: "Show this help" },
  ],
  env: [
    { name: "DEVTUN_INSTANCE", description: "Default instance when --instance isn't passed." },
  ],
  exits: [
    { code: 0, meaning: "Stack started" },
    { code: 1, meaning: "Config missing, socket drift detected, or Docker error" },
  ],
  examples: [
    { description: "Start devtun", command: "devtun up" },
    { description: "Start a named instance", command: "devtun up -i lightsout" },
  ],
};

export async function up(args: string[] = []): Promise<void> {
  if (handleHelp(args, upHelp)) return;

  const { flags } = parseFlags(args, {
    string: ["instance"],
    aliases: { i: "instance" },
  });
  const inst = resolveInstance(flags);
  const config = loadConfig(inst.dir);

  if (!config.tunnelToken) {
    throw new Error("No tunnel token found. Run 'devtun setup' first.");
  }

  const driftedSocket = checkComposeSocketDrift(inst, config);
  if (driftedSocket) {
    throw new Error(
      `docker-compose.yml mounts ${driftedSocket} but config dockerSocket is ${dockerSocketOf(config)}.\n` +
      `Run: devtun config set dockerSocket ${driftedSocket}\n` +
      `(or delete ${inst.dir}/docker-compose.yml to accept regeneration)`
    );
  }

  writeInfraCompose(inst, config);
  writeEnvFile(inst.dir, { TUNNEL_TOKEN: config.tunnelToken });
  composeUp({ cwd: inst.dir, dockerSocket: dockerSocketOf(config) });

  out.blank();
  out.success(`devtun is running.${inst.isDefault ? "" : ` (instance: ${inst.name})`}`);
  if (config.dashboardPort) {
    out.info(`Traefik dashboard: http://localhost:${config.dashboardPort}`);
  }
  out.blank();
}
