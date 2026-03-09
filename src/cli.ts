import { setup } from "./commands/setup.js";
import { add } from "./commands/add.js";
import { remove } from "./commands/remove.js";
import { list } from "./commands/list.js";
import { status } from "./commands/status.js";
import { up } from "./commands/up.js";
import { down } from "./commands/down.js";
import { autostart } from "./commands/autostart.js";
import { config } from "./commands/config.js";
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
  add <name>            Register <name> and configure Docker labels
  remove <name>         Remove a project hostname
  list                  List all registered projects
  status [name]         Show project or infrastructure status

Config:
  config                Show current configuration
  config set <k> <v>    Update a config value
  config get <key>      Get a config value

System:
  autostart <action>    Manage start-on-boot (enable|disable|status)
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
      return add(args[0]);
    case "remove":
    case "rm":
      return remove(args[0]);
    case "list":
    case "ls":
      return list();
    case "status":
      return status(args[0]);
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
