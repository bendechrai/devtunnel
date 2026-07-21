import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import {
  DEFAULT_INSTANCE,
  validateInstanceName,
  instanceDir,
  resolveInstance,
  listInstances,
} from "../../src/lib/instance.js";
import { makeIsolatedHome, type IsolatedHome } from "../helpers/config-dir.js";

describe("instance: validateInstanceName", () => {
  it("accepts simple lowercase names", () => {
    expect(() => validateInstanceName("devtun")).not.toThrow();
    expect(() => validateInstanceName("lightsout")).not.toThrow();
    expect(() => validateInstanceName("dev-2")).not.toThrow();
    expect(() => validateInstanceName("a")).not.toThrow();
  });

  it("rejects docker0 (dual-daemon bridge constraint)", () => {
    expect(() => validateInstanceName("docker0")).toThrow(/reserved/);
  });

  it("rejects Docker reserved network names", () => {
    for (const name of ["default", "bridge", "host", "none"]) {
      expect(() => validateInstanceName(name)).toThrow(/reserved/);
    }
  });

  it("rejects uppercase, leading/trailing hyphens, and other invalid shapes", () => {
    for (const name of ["Devtun", "-dev", "dev-", "dev_tun", "dev.tun", ""]) {
      expect(() => validateInstanceName(name)).toThrow(/Invalid instance name/);
    }
  });

  it("rejects names longer than 32 chars", () => {
    expect(() => validateInstanceName("a".repeat(33))).toThrow(/too long/);
    expect(() => validateInstanceName("a".repeat(32))).not.toThrow();
  });
});

describe("instance: paths and resolution", () => {
  let home: IsolatedHome;

  beforeEach(() => {
    home = makeIsolatedHome();
  });

  afterEach(() => {
    home.cleanup();
    delete process.env["DEVTUN_INSTANCE"];
  });

  it("maps the default instance to ~/.devtun", () => {
    expect(instanceDir(DEFAULT_INSTANCE)).toBe(home.configDir);
  });

  it("maps named instances to ~/.devtun/instances/<name>", () => {
    expect(instanceDir("lightsout")).toBe(
      join(home.configDir, "instances", "lightsout")
    );
  });

  it("defaults to the 'devtun' instance", () => {
    const inst = resolveInstance({});
    expect(inst.name).toBe("devtun");
    expect(inst.isDefault).toBe(true);
    expect(inst.dir).toBe(home.configDir);
  });

  it("uses DEVTUN_INSTANCE when no flag is passed", () => {
    process.env["DEVTUN_INSTANCE"] = "lightsout";
    const inst = resolveInstance({});
    expect(inst.name).toBe("lightsout");
    expect(inst.isDefault).toBe(false);
    expect(inst.dir).toBe(join(home.configDir, "instances", "lightsout"));
  });

  it("prefers the flag over DEVTUN_INSTANCE", () => {
    process.env["DEVTUN_INSTANCE"] = "lightsout";
    const inst = resolveInstance({ instance: "alt" });
    expect(inst.name).toBe("alt");
  });

  it("validates the resolved name", () => {
    expect(() => resolveInstance({ instance: "docker0" })).toThrow(/reserved/);
    process.env["DEVTUN_INSTANCE"] = "Bad Name";
    expect(() => resolveInstance({})).toThrow(/Invalid instance name/);
  });

  it("lists instances that have a config.json", () => {
    expect(listInstances()).toEqual([]);
    home.writeConfig(
      { domain: "example.com", devSubdomain: "dev.example.com", tunnelName: "t" }
    );
    home.writeConfig(
      { domain: "other.com", devSubdomain: "dev.other.com", tunnelName: "t2" },
      "alt"
    );
    expect(listInstances()).toEqual(["devtun", "alt"]);
  });
});
