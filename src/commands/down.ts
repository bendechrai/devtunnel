import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { composeDown } from "../lib/docker.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";

const downHelp: HelpDoc = {
  command: "down",
  synopsis: "devtun down [--help]",
  description: "Stop the devtun infrastructure containers (Traefik + cloudflared).",
  flags: [{ name: "help", aliases: ["h"], description: "Show this help" }],
  exits: [
    { code: 0, meaning: "Stack stopped" },
    { code: 1, meaning: "Config missing or Docker error" },
  ],
  examples: [{ description: "Stop devtun", command: "devtun down" }],
};

export async function down(args: string[] = []): Promise<void> {
  if (handleHelp(args, downHelp)) return;

  loadConfig();
  composeDown();

  out.blank();
  out.success("devtun stopped.");
  out.blank();
}
