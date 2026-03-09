import { execFileSync, execSync } from "child_process";
import { configDir } from "./config.js";

function compose(args: string[], cwd?: string): string {
  return execFileSync("docker", ["compose", ...args], {
    cwd: cwd ?? configDir(),
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function composeUp(cwd?: string): void {
  execFileSync("docker", ["compose", "up", "-d"], {
    cwd: cwd ?? configDir(),
    stdio: "inherit",
  });
}

export function composeDown(cwd?: string): void {
  execFileSync("docker", ["compose", "down"], {
    cwd: cwd ?? configDir(),
    stdio: "inherit",
  });
}

export function isDockerRunning(): boolean {
  try {
    execFileSync("docker", ["info"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function isStackRunning(): boolean {
  try {
    const output = compose(["ps", "--format", "json"]);
    return output.length > 0;
  } catch {
    return false;
  }
}

export function restartProject(cwd: string): void {
  execSync("docker compose up -d", {
    cwd,
    stdio: "inherit",
  });
}
