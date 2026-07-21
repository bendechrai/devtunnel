import { join } from "path";
import { homedir } from "os";
import { existsSync, readdirSync } from "fs";

export const DEFAULT_INSTANCE = "devtun";

/**
 * Names that must never become a Docker network. "docker0" is a hard host
 * constraint (dual-daemon hosts delete each other's docker0 bridge); the
 * rest are Docker's reserved network names.
 */
const RESERVED_NAMES = new Set(["docker0", "default", "bridge", "host", "none"]);

const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME_LENGTH = 32;

export interface InstanceContext {
  name: string;
  dir: string;
  isDefault: boolean;
}

export function validateInstanceName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Invalid instance name: ${name}\n` +
      "Use lowercase letters, digits, and hyphens (no leading/trailing hyphen)."
    );
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Instance name too long: ${name} (max ${MAX_NAME_LENGTH} chars)`
    );
  }
  if (RESERVED_NAMES.has(name)) {
    throw new Error(
      `Instance name '${name}' is reserved (it would collide with a Docker network name).`
    );
  }
}

export function instanceDir(name: string): string {
  if (name === DEFAULT_INSTANCE) {
    return join(homedir(), ".devtun");
  }
  return join(homedir(), ".devtun", "instances", name);
}

/**
 * Resolve the target instance: --instance/-i flag > DEVTUN_INSTANCE > default.
 */
export function resolveInstance(
  flags: Record<string, string | boolean>
): InstanceContext {
  const fromFlag = flags["instance"];
  const name =
    (typeof fromFlag === "string" && fromFlag) ||
    process.env["DEVTUN_INSTANCE"] ||
    DEFAULT_INSTANCE;
  validateInstanceName(name);
  return { name, dir: instanceDir(name), isDefault: name === DEFAULT_INSTANCE };
}

export function listInstances(): string[] {
  const names: string[] = [];
  if (existsSync(join(instanceDir(DEFAULT_INSTANCE), "config.json"))) {
    names.push(DEFAULT_INSTANCE);
  }
  const instancesRoot = join(homedir(), ".devtun", "instances");
  if (existsSync(instancesRoot)) {
    for (const entry of readdirSync(instancesRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(instancesRoot, entry.name, "config.json"))) {
        names.push(entry.name);
      }
    }
  }
  return names;
}
