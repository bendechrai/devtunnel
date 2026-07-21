import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import * as out from "../lib/output.js";
import { loadConfig, dockerSocketOf, DEFAULT_DOCKER_SOCKET } from "../lib/config.js";
import { resolveInstance, type InstanceContext } from "../lib/instance.js";
import { parseFlags } from "../lib/flags.js";
import { handleHelp, type HelpDoc } from "../lib/help.js";
import type { DevtunnelConfig } from "../lib/types.js";

const autostartHelp: HelpDoc = {
  command: "autostart",
  synopsis: "devtun autostart <enable|disable|status> [--instance <name>] [--help]",
  description:
    "Manage devtun's start-on-boot configuration. macOS installs a LaunchAgent at\n~/Library/LaunchAgents/com.devtun.plist; Linux installs a user systemd unit at\n~/.config/systemd/user/devtun.service. Named instances get their own unit\n(com.devtun.<name>.plist / devtun-<name>.service), so instances can autostart independently.",
  args: [
    {
      name: "action",
      required: true,
      description: "One of: enable, disable, status.",
    },
  ],
  flags: [
    { name: "instance", aliases: ["i"], type: "string", description: "Target instance. Defaults to DEVTUN_INSTANCE or 'devtun'." },
    { name: "help", aliases: ["h"], description: "Show this help" },
  ],
  env: [
    { name: "DEVTUN_INSTANCE", description: "Default instance when --instance isn't passed." },
  ],
  exits: [
    { code: 0, meaning: "Action completed" },
    { code: 1, meaning: "Bad action, unsupported platform, or system error" },
  ],
  examples: [
    { description: "Start devtun on login", command: "devtun autostart enable" },
    { description: "Stop starting on login", command: "devtun autostart disable" },
    { description: "Check current state", command: "devtun autostart status" },
    { description: "Autostart a named instance", command: "devtun autostart enable -i lightsout" },
  ],
};

function dockerPath(): string {
  try {
    return execFileSync("which", ["docker"], { encoding: "utf-8" }).trim();
  } catch {
    return "/usr/local/bin/docker";
  }
}

// The default instance keeps the legacy unit names (com.devtun / devtun.service)
// so existing installs survive upgrades untouched.
function launchAgentLabel(inst: InstanceContext): string {
  return inst.isDefault ? "com.devtun" : `com.devtun.${inst.name}`;
}

function launchAgentPath(inst: InstanceContext): string {
  return join(homedir(), "Library", "LaunchAgents", `${launchAgentLabel(inst)}.plist`);
}

function systemdServiceName(inst: InstanceContext): string {
  return inst.isDefault ? "devtun" : `devtun-${inst.name}`;
}

function systemdUnitPath(inst: InstanceContext): string {
  return join(
    homedir(),
    ".config",
    "systemd",
    "user",
    `${systemdServiceName(inst)}.service`
  );
}

function generatePlist(inst: InstanceContext, cfg: DevtunnelConfig): string {
  const dir = inst.dir;
  const socket = dockerSocketOf(cfg);
  const envBlock =
    socket !== DEFAULT_DOCKER_SOCKET
      ? `
  <key>EnvironmentVariables</key>
  <dict>
    <key>DOCKER_HOST</key>
    <string>unix://${socket}</string>
  </dict>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchAgentLabel(inst)}</string>${envBlock}
  <key>ProgramArguments</key>
  <array>
    <string>${dockerPath()}</string>
    <string>compose</string>
    <string>-f</string>
    <string>${dir}/docker-compose.yml</string>
    <string>--env-file</string>
    <string>${dir}/.env</string>
    <string>up</string>
    <string>-d</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${dir}/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${dir}/launchd.log</string>
</dict>
</plist>`;
}

function generateSystemdUnit(inst: InstanceContext, cfg: DevtunnelConfig): string {
  const dir = inst.dir;
  const socket = dockerSocketOf(cfg);
  const envLine =
    socket !== DEFAULT_DOCKER_SOCKET
      ? `Environment=DOCKER_HOST=unix://${socket}\n`
      : "";
  return `[Unit]
Description=devtun (${inst.name}) - Traefik + Cloudflare Tunnel
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
${envLine}ExecStart=${dockerPath()} compose -f ${dir}/docker-compose.yml --env-file ${dir}/.env up -d
ExecStop=${dockerPath()} compose -f ${dir}/docker-compose.yml down

[Install]
WantedBy=default.target
`;
}

function enable(inst: InstanceContext): void {
  const cfg = loadConfig(inst.dir);

  if (process.platform === "darwin") {
    const plistPath = launchAgentPath(inst);
    writeFileSync(plistPath, generatePlist(inst, cfg));
    execFileSync("launchctl", ["load", plistPath], { stdio: "inherit" });
    out.success("LaunchAgent installed. devtun will start on login.");
    out.dim(plistPath);
  } else if (process.platform === "linux") {
    const unitPath = systemdUnitPath(inst);
    const unitDir = join(homedir(), ".config", "systemd", "user");
    execFileSync("mkdir", ["-p", unitDir]);
    writeFileSync(unitPath, generateSystemdUnit(inst, cfg));
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    execFileSync("systemctl", ["--user", "enable", systemdServiceName(inst)], { stdio: "inherit" });
    out.success("systemd user unit installed and enabled.");
    out.dim(unitPath);
  } else {
    throw new Error(`Autostart not supported on ${process.platform}`);
  }
}

function disable(inst: InstanceContext): void {
  if (process.platform === "darwin") {
    const plistPath = launchAgentPath(inst);
    if (existsSync(plistPath)) {
      execFileSync("launchctl", ["unload", plistPath], { stdio: "inherit" });
      unlinkSync(plistPath);
      out.success("LaunchAgent removed.");
    } else {
      out.info("Autostart is not enabled.");
    }
  } else if (process.platform === "linux") {
    const unitPath = systemdUnitPath(inst);
    if (existsSync(unitPath)) {
      execFileSync("systemctl", ["--user", "disable", systemdServiceName(inst)], { stdio: "inherit" });
      unlinkSync(unitPath);
      execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
      out.success("systemd unit removed.");
    } else {
      out.info("Autostart is not enabled.");
    }
  } else {
    throw new Error(`Autostart not supported on ${process.platform}`);
  }
}

function showStatus(inst: InstanceContext): void {
  if (process.platform === "darwin") {
    const plistPath = launchAgentPath(inst);
    if (existsSync(plistPath)) {
      out.info("Autostart: enabled (macOS LaunchAgent)");
      out.dim(plistPath);
    } else {
      out.info("Autostart: disabled");
    }
  } else if (process.platform === "linux") {
    const unitPath = systemdUnitPath(inst);
    if (existsSync(unitPath)) {
      out.info("Autostart: enabled (systemd user unit)");
      out.dim(unitPath);
    } else {
      out.info("Autostart: disabled");
    }
  } else {
    out.info(`Autostart not supported on ${process.platform}`);
  }
}

export async function autostart(args: string[] = []): Promise<void> {
  if (handleHelp(args, autostartHelp)) return;

  const { positional, flags } = parseFlags(args, {
    string: ["instance"],
    aliases: { i: "instance" },
  });
  const inst = resolveInstance(flags);

  const action = positional[0];
  switch (action) {
    case "enable":
      enable(inst);
      break;
    case "disable":
      disable(inst);
      break;
    case "status":
      showStatus(inst);
      break;
    default:
      throw new Error(
        "Usage: devtun autostart <enable|disable|status> [--instance <name>]"
      );
  }
}
