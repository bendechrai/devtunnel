import { execFileSync } from "child_process";
import { DEFAULT_DOCKER_SOCKET } from "./config.js";

export interface DockerCtx {
  cwd: string;
  dockerSocket?: string;
}

function dockerEnv(dockerSocket?: string): NodeJS.ProcessEnv {
  if (dockerSocket && dockerSocket !== DEFAULT_DOCKER_SOCKET) {
    return { ...process.env, DOCKER_HOST: `unix://${dockerSocket}` };
  }
  return process.env;
}

function compose(args: string[], ctx: DockerCtx): string {
  return execFileSync("docker", ["compose", ...args], {
    cwd: ctx.cwd,
    env: dockerEnv(ctx.dockerSocket),
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function composeUp(ctx: DockerCtx): void {
  execFileSync("docker", ["compose", "up", "-d"], {
    cwd: ctx.cwd,
    env: dockerEnv(ctx.dockerSocket),
    stdio: "inherit",
  });
}

export function composeDown(ctx: DockerCtx): void {
  execFileSync("docker", ["compose", "down"], {
    cwd: ctx.cwd,
    env: dockerEnv(ctx.dockerSocket),
    stdio: "inherit",
  });
}

export function isDockerRunning(dockerSocket?: string): boolean {
  try {
    execFileSync("docker", ["info"], {
      env: dockerEnv(dockerSocket),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function isStackRunning(ctx: DockerCtx): boolean {
  try {
    const output = compose(["ps", "--format", "json"], ctx);
    return output.length > 0;
  } catch {
    return false;
  }
}

export function restartProject(cwd: string, dockerSocket?: string): void {
  execFileSync("docker", ["compose", "up", "-d"], {
    cwd,
    env: dockerEnv(dockerSocket),
    stdio: "inherit",
  });
}
