import * as out from "../lib/output.js";
import { loadConfig, dockerSocketOf } from "../lib/config.js";
import { composeDown } from "../lib/docker.js";
import { resolveInstance } from "../lib/instance.js";
import { parseFlags } from "../lib/flags.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";

const downHelp: HelpDoc = {
  command: "down",
  synopsis: "devtun down [--instance <name>] [--help]",
  description: "Stop the devtun infrastructure containers (Traefik + cloudflared).",
  flags: [
    { name: "instance", aliases: ["i"], type: "string", description: "Target instance. Defaults to DEVTUN_INSTANCE or 'devtun'." },
    { name: "help", aliases: ["h"], description: "Show this help" },
  ],
  env: [
    { name: "DEVTUN_INSTANCE", description: "Default instance when --instance isn't passed." },
  ],
  exits: [
    { code: 0, meaning: "Stack stopped" },
    { code: 1, meaning: "Config missing or Docker error" },
  ],
  examples: [
    { description: "Stop devtun", command: "devtun down" },
    { description: "Stop a named instance", command: "devtun down -i lightsout" },
  ],
};

export async function down(args: string[] = []): Promise<void> {
  if (handleHelp(args, downHelp)) return;

  const { flags } = parseFlags(args, {
    string: ["instance"],
    aliases: { i: "instance" },
  });
  const inst = resolveInstance(flags);
  const config = loadConfig(inst.dir);
  composeDown({ cwd: inst.dir, dockerSocket: dockerSocketOf(config) });

  out.blank();
  out.success(`devtun stopped.${inst.isDefault ? "" : ` (instance: ${inst.name})`}`);
  out.blank();
}
