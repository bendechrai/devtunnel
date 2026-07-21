import * as out from "../lib/output.js";
import { loadConfig, dockerSocketOf } from "../lib/config.js";
import { instanceDir, listInstances } from "../lib/instance.js";
import { isStackRunning } from "../lib/docker.js";
import { parseFlags } from "../lib/flags.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";

const instancesHelp: HelpDoc = {
  command: "instances",
  synopsis: "devtun instances [--json] [--help]",
  description:
    "List all devtun instances on this machine with their FQDN, Docker socket, and stack state.\nThe default instance lives at ~/.devtun; named instances at ~/.devtun/instances/<name>.",
  flags: [
    { name: "json", description: "Emit an array of { name, devSubdomain, dockerSocket, running, dir }." },
    { name: "help", aliases: ["h"], description: "Show this help" },
  ],
  exits: [
    { code: 0, meaning: "Success" },
  ],
  examples: [
    { description: "List instances", command: "devtun instances" },
    { description: "Names only", command: "devtun instances --json | jq -r '.[].name'" },
  ],
};

export async function instances(args: string[] = []): Promise<void> {
  if (handleHelp(args, instancesHelp)) return;
  const { flags } = parseFlags(args, { boolean: ["json"] });
  const asJson = flags["json"] === true;
  if (asJson) out.setJsonMode(true);

  const rows = listInstances().map((name) => {
    const dir = instanceDir(name);
    const cfg = loadConfig(dir);
    const dockerSocket = dockerSocketOf(cfg);
    const running = isStackRunning({ cwd: dir, dockerSocket });
    return { name, devSubdomain: cfg.devSubdomain, dockerSocket, running, dir };
  });

  if (asJson) {
    out.json(rows);
    return;
  }

  out.header("devtun instances");
  if (rows.length === 0) {
    out.info("(none)");
    out.blank();
    out.info("Create one with: devtun setup");
    out.blank();
    return;
  }
  out.table(
    rows.map((r) => ({
      instance: r.name,
      fqdn: `*.${r.devSubdomain}`,
      socket: r.dockerSocket,
      state: r.running ? "running" : "stopped",
    })),
    ["instance", "fqdn", "socket", "state"]
  );
  out.blank();
}
