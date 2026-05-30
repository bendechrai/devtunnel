import { setup } from "./commands/setup.js";
import { add } from "./commands/add.js";
import { remove } from "./commands/remove.js";
import { list } from "./commands/list.js";
import { status } from "./commands/status.js";
import { up } from "./commands/up.js";
import { down } from "./commands/down.js";
import { autostart } from "./commands/autostart.js";
import { config } from "./commands/config.js";
import { doctor } from "./commands/doctor.js";
import * as out from "./lib/output.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

function usage(): void {
  console.log(`
devtun v${VERSION}
Public HTTPS URLs for local Docker containers.

Usage: devtun <command> [args]

Setup:
  setup                 One-time infrastructure setup (idempotent)
  up                    Start Traefik + tunnel containers
  down                  Stop Traefik + tunnel containers

Projects:
  add <name> <svc> <port>  Register <name> routing to <svc> on <port>
                           Flags: --restart | --no-restart | --yes (-y)
  remove <name>         Remove a project hostname
                           Flags: --restart | --no-restart | --yes (-y)
  list                  List all registered projects                 [--json]
  status [name]         Show project or infrastructure status        [--json]

Config:
  config                Show current configuration                   [--json]
  config set <k> <v>    Update a config value                       [--force]
  config get <key>      Get a config value                           [--json]

System:
  autostart <action>    Manage start-on-boot (enable|disable|status)
  doctor                Health checks on config and Cloudflare state [--json]
  help                  Show this help
  version               Show version
`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "setup":
      return setup();
    case "init":
    case "add":
      return add(args);
    case "remove":
    case "rm":
      return remove(args);
    case "list":
    case "ls":
      return list(args);
    case "status":
      return status(args);
    case "up":
    case "start":
      return up();
    case "down":
    case "stop":
      return down();
    case "config":
      return config(args);
    case "autostart":
      return autostart(args[0]);
    case "doctor":
      return doctor(args);
    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      usage();
      return;
    default:
      out.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch((err: Error) => {
  out.error(err.message);
  process.exit(1);
});
