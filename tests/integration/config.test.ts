import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startMockCloudflare, addZone, type MockServer } from "../helpers/cf-mock.js";
import { makeIsolatedHome, type IsolatedHome } from "../helpers/config-dir.js";

vi.mock("../../src/lib/docker.js", () => ({
  isDockerRunning: vi.fn().mockReturnValue(true),
  isStackRunning: vi.fn().mockReturnValue(false),
  restartProject: vi.fn(),
  composeUp: vi.fn(),
  composeDown: vi.fn(),
}));

describe("config set (integration)", () => {
  let mock: MockServer;
  let home: IsolatedHome;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    process.env["CLOUDFLARE_API_TOKEN"] = "test-token";
    mock = startMockCloudflare();
    home = makeIsolatedHome();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { resetTokenCache } = await import("../../src/lib/token.js");
    resetTokenCache();
  });

  afterEach(() => {
    mock.server.close();
    home.cleanup();
    logSpy.mockRestore();
    errSpy.mockRestore();
    delete process.env["CLOUDFLARE_API_TOKEN"];
  });

  describe("domain", () => {
    it("is a no-op when value equals current", async () => {
      const zone = addZone(mock.state, "example.com");
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: zone.id,
        accountId: zone.accountId,
        tunnelId: "tunnel-xyz",
        tunnelToken: "tok",
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["set", "domain", "example.com"]);

      const cfg = home.readConfig();
      expect(cfg.zoneId).toBe(zone.id);
      expect(cfg.tunnelId).toBe("tunnel-xyz");
    });

    it("refuses to change if hostnames still exist on old zone", async () => {
      const oldZone = addZone(mock.state, "old.com");
      addZone(mock.state, "new.com");
      oldZone.customHostnames.set("ch1", {
        id: "ch1",
        hostname: "myapp.dev.old.com",
        status: "active",
        created_at: new Date().toISOString(),
        ssl: { status: "active", method: "http", type: "dv" },
      });
      home.writeConfig({
        domain: "old.com",
        devSubdomain: "dev.old.com",
        tunnelName: "dev-old-com",
        zoneId: oldZone.id,
        accountId: oldZone.accountId,
        tunnelId: "tunnel-xyz",
      });

      const { config } = await import("../../src/commands/config.js");
      await expect(
        config(["set", "domain", "new.com"])
      ).rejects.toThrow(/Refusing/);

      const cfg = home.readConfig();
      expect(cfg.domain).toBe("old.com");
      expect(cfg.zoneId).toBe(oldZone.id);
    });

    it("--force allows change even with orphaned hostnames", async () => {
      const oldZone = addZone(mock.state, "old.com");
      addZone(mock.state, "new.com");
      oldZone.customHostnames.set("ch1", {
        id: "ch1",
        hostname: "myapp.dev.old.com",
        status: "active",
        created_at: new Date().toISOString(),
        ssl: { status: "active", method: "http", type: "dv" },
      });
      home.writeConfig({
        domain: "old.com",
        devSubdomain: "dev.old.com",
        tunnelName: "dev-old-com",
        zoneId: oldZone.id,
        accountId: oldZone.accountId,
        tunnelId: "tunnel-xyz",
        tunnelToken: "tok",
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["set", "domain", "new.com", "--force"]);

      const cfg = home.readConfig();
      expect(cfg.domain).toBe("new.com");
      expect(cfg.zoneId).toBeUndefined();
      expect(cfg.accountId).toBeUndefined();
      expect(cfg.tunnelId).toBeUndefined();
      expect(cfg.tunnelToken).toBeUndefined();
    });

    it("clears derived state on a clean swap", async () => {
      const oldZone = addZone(mock.state, "old.com");
      addZone(mock.state, "new.com");
      home.writeConfig({
        domain: "old.com",
        devSubdomain: "dev.old.com",
        tunnelName: "dev-old-com",
        zoneId: oldZone.id,
        accountId: oldZone.accountId,
        tunnelId: "tunnel-xyz",
        tunnelToken: "tok",
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["set", "domain", "new.com"]);

      const cfg = home.readConfig();
      expect(cfg.domain).toBe("new.com");
      expect(cfg.zoneId).toBeUndefined();
      expect(cfg.accountId).toBeUndefined();
      expect(cfg.tunnelId).toBeUndefined();
      expect(cfg.tunnelToken).toBeUndefined();
      // Unrelated keys preserved
      expect(cfg.tunnelName).toBe("dev-old-com");
      expect(cfg.devSubdomain).toBe("dev.old.com");
    });

    it("refuses if the token cannot see the new zone", async () => {
      const oldZone = addZone(mock.state, "old.com");
      // Note: "unknown.com" is NOT added to mock state
      home.writeConfig({
        domain: "old.com",
        devSubdomain: "dev.old.com",
        tunnelName: "dev-old-com",
        zoneId: oldZone.id,
        accountId: oldZone.accountId,
      });

      const { config } = await import("../../src/commands/config.js");
      await expect(
        config(["set", "domain", "unknown.com"])
      ).rejects.toThrow(/Cannot use unknown.com/);

      // No mutation
      const cfg = home.readConfig();
      expect(cfg.domain).toBe("old.com");
    });
  });

  describe("devSubdomain", () => {
    it("refuses if hostnames exist on the old subdomain", async () => {
      const zone = addZone(mock.state, "example.com");
      zone.customHostnames.set("ch1", {
        id: "ch1",
        hostname: "myapp.dev.example.com",
        status: "active",
        created_at: new Date().toISOString(),
        ssl: { status: "active", method: "http", type: "dv" },
      });
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: zone.id,
        accountId: zone.accountId,
      });

      const { config } = await import("../../src/commands/config.js");
      await expect(
        config(["set", "devSubdomain", "preview.example.com"])
      ).rejects.toThrow(/Refusing/);
    });

    it("allows change when only hostnames on a different subdomain exist", async () => {
      const zone = addZone(mock.state, "example.com");
      // A hostname on a SIBLING subdomain that we don't care about
      zone.customHostnames.set("ch1", {
        id: "ch1",
        hostname: "production.example.com",
        status: "active",
        created_at: new Date().toISOString(),
        ssl: { status: "active", method: "http", type: "dv" },
      });
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: zone.id,
        accountId: zone.accountId,
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["set", "devSubdomain", "preview.example.com"]);

      const cfg = home.readConfig();
      expect(cfg.devSubdomain).toBe("preview.example.com");
    });
  });

  describe("tunnelName", () => {
    it("clears tunnelId and tunnelToken", async () => {
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-old",
        zoneId: "z1",
        accountId: "a1",
        tunnelId: "tunnel-xyz",
        tunnelToken: "tok",
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["set", "tunnelName", "dev-new"]);

      const cfg = home.readConfig();
      expect(cfg.tunnelName).toBe("dev-new");
      expect(cfg.tunnelId).toBeUndefined();
      expect(cfg.tunnelToken).toBeUndefined();
      // Zone state preserved (same domain)
      expect(cfg.zoneId).toBe("z1");
      expect(cfg.accountId).toBe("a1");
    });
  });

  describe("cfTokenSource", () => {
    it("plain write, no validation", async () => {
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example",
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["set", "cfTokenSource", "op://Personal/CF/token"]);

      const cfg = home.readConfig();
      expect(cfg.cfTokenSource).toBe("op://Personal/CF/token");
    });
  });

  describe("guards", () => {
    it("rejects unknown keys", async () => {
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example",
      });

      const { config } = await import("../../src/commands/config.js");
      await expect(config(["set", "bogus", "x"])).rejects.toThrow(/Unknown config key/);
    });

    it("requires both key and value", async () => {
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example",
      });

      const { config } = await import("../../src/commands/config.js");
      await expect(config(["set"])).rejects.toThrow(/Usage/);
      await expect(config(["set", "domain"])).rejects.toThrow(/Usage/);
    });
  });
});
