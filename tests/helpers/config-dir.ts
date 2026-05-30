import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DevtunnelConfig } from "../../src/lib/types.js";

export interface IsolatedHome {
  homeDir: string;
  configDir: string;
  configFile: string;
  cleanup: () => void;
  writeConfig: (cfg: DevtunnelConfig) => void;
  readConfig: () => DevtunnelConfig;
  configExists: () => boolean;
}

export function makeIsolatedHome(): IsolatedHome {
  const homeDir = mkdtempSync(join(tmpdir(), "devtun-home-"));
  const configDir = join(homeDir, ".devtun");
  mkdirSync(configDir, { recursive: true });
  const configFile = join(configDir, "config.json");

  const originalHome = process.env["HOME"];
  process.env["HOME"] = homeDir;

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
    writeConfig: (cfg) => {
      writeFileSync(configFile, JSON.stringify(cfg, null, 2));
    },
    readConfig: () => {
      return JSON.parse(readFileSync(configFile, "utf-8")) as DevtunnelConfig;
    },
    configExists: () => existsSync(configFile),
  };
}
