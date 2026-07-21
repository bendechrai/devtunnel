import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DevtunnelConfig } from "../../src/lib/types.js";

export interface IsolatedHome {
  homeDir: string;
  configDir: string;
  configFile: string;
  cleanup: () => void;
  writeConfig: (cfg: DevtunnelConfig, instance?: string) => void;
  readConfig: (instance?: string) => DevtunnelConfig;
  configExists: (instance?: string) => boolean;
  instanceDir: (instance: string) => string;
}

export function makeIsolatedHome(): IsolatedHome {
  const homeDir = mkdtempSync(join(tmpdir(), "devtun-home-"));
  const configDir = join(homeDir, ".devtun");
  mkdirSync(configDir, { recursive: true });
  const configFile = join(configDir, "config.json");

  const originalHome = process.env["HOME"];
  process.env["HOME"] = homeDir;

  const instanceDir = (instance: string): string =>
    instance === "devtun" ? configDir : join(configDir, "instances", instance);
  const instanceConfigFile = (instance?: string): string =>
    instance === undefined ? configFile : join(instanceDir(instance), "config.json");

  return {
    homeDir,
    configDir,
    configFile,
    cleanup: () => {
      if (originalHome === undefined) {
        delete process.env["HOME"];
      } else {
        process.env["HOME"] = originalHome;
      }
      rmSync(homeDir, { recursive: true, force: true });
    },
    writeConfig: (cfg, instance) => {
      const file = instanceConfigFile(instance);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify(cfg, null, 2));
    },
    readConfig: (instance) => {
      return JSON.parse(readFileSync(instanceConfigFile(instance), "utf-8")) as DevtunnelConfig;
    },
    configExists: (instance) => existsSync(instanceConfigFile(instance)),
    instanceDir,
  };
}
