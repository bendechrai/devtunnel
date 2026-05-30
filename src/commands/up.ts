import * as out from "../lib/output.js";
import { loadConfig, writeEnvFile } from "../lib/config.js";
import { writeInfraCompose } from "../lib/compose.js";
import { composeUp } from "../lib/docker.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";

const upHelp: HelpDoc = {
  command: "up",
  synopsis: "devtun up [--help]",
  description:
    "Start the devtun infrastructure containers (Traefik + cloudflared) using Docker Compose.\nRegenerates ~/.devtun/docker-compose.yml and ~/.devtun/.env from config every run.",
  flags: [{ name: "help", aliases: ["h"], description: "Show this help" }],
  exits: [
    { code: 0, meaning: "Stack started" },
    { code: 1, meaning: "Config missing or Docker error" },
  ],
  examples: [{ description: "Start devtun", command: "devtun up" }],
};

export async function up(args: string[] = []): Promise<void> {
  if (handleHelp(args, upHelp)) return;

  const config = loadConfig();

  if (!config.tunnelToken) {
    throw new Error("No tunnel token found. Run 'devtun setup' first.");
  }

  writeInfraCompose();
  writeEnvFile({ TUNNEL_TOKEN: config.tunnelToken });
  composeUp();

  out.blank();
  out.success("devtun is running.");
  out.info("Traefik dashboard: http://localhost:8080");
  out.blank();
}
