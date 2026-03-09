import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import * as out from "../lib/output.js";
import { loadConfig, configDir } from "../lib/config.js";

function dockerPath(): string {
  try {
    return execFileSync("which", ["docker"], { encoding: "utf-8" }).trim();
  } catch {
    return "/usr/local/bin/docker";
  }
}

function launchAgentPath(): string {
  return join(homedir(), "Library", "LaunchAgents", "com.devtun.plist");
}

function systemdUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", "devtun.service");
}

function generatePlist(): string {
  const dir = configDir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.devtun</string>
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

function generateSystemdUnit(): string {
  const dir = configDir();
  return `[Unit]
Description=devtun - Traefik + Cloudflare Tunnel
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${dockerPath()} compose -f ${dir}/docker-compose.yml --env-file ${dir}/.env up -d
ExecStop=${dockerPath()} compose -f ${dir}/docker-compose.yml down

[Install]
WantedBy=default.target
`;
}

function enable(): void {
  loadConfig(); // validate setup

  if (process.platform === "darwin") {
    const plistPath = launchAgentPath();
    writeFileSync(plistPath, generatePlist());
    execFileSync("launchctl", ["load", plistPath], { stdio: "inherit" });
    out.success("LaunchAgent installed. devtun will start on login.");
    out.dim(plistPath);
  } else if (process.platform === "linux") {
    const unitPath = systemdUnitPath();
    const unitDir = join(homedir(), ".config", "systemd", "user");
    execFileSync("mkdir", ["-p", unitDir]);
    writeFileSync(unitPath, generateSystemdUnit());
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    execFileSync("systemctl", ["--user", "enable", "devtun"], { stdio: "inherit" });
    out.success("systemd user unit installed and enabled.");
    out.dim(unitPath);
  } else {
    throw new Error(`Autostart not supported on ${process.platform}`);
  }
}

function disable(): void {
  if (process.platform === "darwin") {
    const plistPath = launchAgentPath();
    if (existsSync(plistPath)) {
      execFileSync("launchctl", ["unload", plistPath], { stdio: "inherit" });
      unlinkSync(plistPath);
      out.success("LaunchAgent removed.");
    } else {
      out.info("Autostart is not enabled.");
    }
  } else if (process.platform === "linux") {
    const unitPath = systemdUnitPath();
    if (existsSync(unitPath)) {
      execFileSync("systemctl", ["--user", "disable", "devtun"], { stdio: "inherit" });
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

function showStatus(): void {
  if (process.platform === "darwin") {
    const plistPath = launchAgentPath();
    if (existsSync(plistPath)) {
      out.info("Autostart: enabled (macOS LaunchAgent)");
      out.dim(plistPath);
    } else {
      out.info("Autostart: disabled");
    }
  } else if (process.platform === "linux") {
    const unitPath = systemdUnitPath();
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

export async function autostart(
  action?: string
): Promise<void> {
  switch (action) {
    case "enable":
      enable();
      break;
    case "disable":
      disable();
      break;
    case "status":
      showStatus();
      break;
    default:
      throw new Error(
        "Usage: devtun autostart <enable|disable|status>"
      );
  }
}
