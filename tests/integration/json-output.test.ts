import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startMockCloudflare, addZone, type MockServer } from "../helpers/cf-mock.js";
import { makeIsolatedHome, type IsolatedHome } from "../helpers/config-dir.js";
import { makeTempDir } from "../helpers/temp-dir.js";
import { captureStdout, type StdoutCapture } from "../helpers/capture-stdout.js";

vi.mock("../../src/lib/docker.js", () => ({
  isDockerRunning: vi.fn().mockReturnValue(true),
  isStackRunning: vi.fn().mockReturnValue(true),
  restartProject: vi.fn(),
  composeUp: vi.fn(),
  composeDown: vi.fn(),
}));

describe("--json output", () => {
  let mock: MockServer;
  let home: IsolatedHome;
  let projectDir: ReturnType<typeof makeTempDir>;
  let stdout: StdoutCapture;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    process.env["CLOUDFLARE_API_TOKEN"] = "test-token";
    mock = startMockCloudflare();
    home = makeIsolatedHome();
    projectDir = makeTempDir("devtun-proj-");
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir.path);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: number): never => {
        throw new Error(`__exit_${code ?? 0}__`);
      });
    stdout = captureStdout();
    const { resetTokenCache } = await import("../../src/lib/token.js");
    resetTokenCache();
    const out = await import("../../src/lib/output.js");
    out.setJsonMode(false);
  });

  afterEach(() => {
    mock.server.close();
    home.cleanup();
    projectDir.cleanup();
    cwdSpy.mockRestore();
    stdout.restore();
    exitSpy.mockRestore();
    vi.restoreAllMocks();
    delete process.env["CLOUDFLARE_API_TOKEN"];
  });

  describe("list --json", () => {
    it("emits an empty array when no projects are registered", async () => {
      const zone = addZone(mock.state, "example.com");
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: zone.id,
        accountId: zone.accountId,
      });

      const { list } = await import("../../src/commands/list.js");
      await list(["--json"]);

      expect(stdout.json()).toEqual([]);
    });

    it("emits one entry per custom hostname with the documented shape", async () => {
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

      const { list } = await import("../../src/commands/list.js");
      await list(["--json"]);

      const result = stdout.json<unknown[]>();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        hostname: "myapp.dev.example.com",
        service: null,
        port: null,
        status: "active",
        ssl: "active",
      });
    });
  });

  describe("status --json", () => {
    it("emits infrastructure status when no project name given", async () => {
      const zone = addZone(mock.state, "example.com");
      zone.fallbackOrigin = {
        origin: "tunnel-origin.example.com",
        status: "active",
      };
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: zone.id,
        accountId: zone.accountId,
        tunnelId: "tunnel-1",
      });

      const { status } = await import("../../src/commands/status.js");
      await status(["--json"]);

      const result = stdout.json<Record<string, unknown>>();
      expect(result).toMatchObject({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnel: { name: "dev-example-com", id: "tunnel-1" },
        zoneId: zone.id,
        accountId: zone.accountId,
        fallback: { origin: "tunnel-origin.example.com", status: "active" },
        projects: [],
      });
    });

    it("emits per-hostname detail when project name given", async () => {
      const zone = addZone(mock.state, "example.com");
      zone.customHostnames.set("ch1", {
        id: "ch1",
        hostname: "myapp.dev.example.com",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
        ssl: { status: "active", method: "http", type: "dv" },
      });
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: zone.id,
        accountId: zone.accountId,
      });

      const { status } = await import("../../src/commands/status.js");
      await status(["myapp", "--json"]);

      expect(stdout.json()).toEqual({
        hostname: "myapp.dev.example.com",
        registered: true,
        status: "active",
        ssl: { status: "active", method: "http" },
        createdAt: "2026-01-01T00:00:00Z",
      });
    });

    it("emits {registered: false} and exits 1 when name not registered", async () => {
      const zone = addZone(mock.state, "example.com");
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: zone.id,
        accountId: zone.accountId,
      });

      const { status } = await import("../../src/commands/status.js");
      await expect(status(["ghost", "--json"])).rejects.toThrow(/__exit_1__/);

      expect(stdout.json()).toEqual({
        hostname: "ghost.dev.example.com",
        registered: false,
      });
    });
  });

  describe("doctor --json", () => {
    it("emits summary + per-check array on a healthy setup", async () => {
      const zone = addZone(mock.state, "example.com");
      zone.fallbackOrigin = {
        origin: "tunnel-origin.example.com",
        status: "active",
      };
      const account = mock.state.accounts.get(zone.accountId);
      if (!account) throw new Error("account not seeded");
      account.tunnels.set("tunnel-1", {
        id: "tunnel-1",
        name: "dev-example-com",
        status: "healthy",
        created_at: new Date().toISOString(),
      });
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: zone.id,
        accountId: zone.accountId,
        tunnelId: "tunnel-1",
      });

      const { doctor } = await import("../../src/commands/doctor.js");
      await doctor(["--json"]);

      const result = stdout.json<{
        summary: { ok: number; warn: number; fail: number; skip: number };
        checks: Array<{ name: string; status: string; detail: string }>;
      }>();
      expect(result.summary).toEqual({ ok: 9, warn: 0, fail: 0, skip: 0 });
      expect(result.checks).toHaveLength(9);
      const names = result.checks.map((c) => c.name);
      expect(names).toContain("config file");
      expect(names).toContain("zone access");
      expect(names).toContain("custom hostnames");
      expect(names).toContain("devtun stack");
      for (const check of result.checks) {
        expect(check.status).toBe("ok");
      }
    });

    it("emits failures and exits 1 when checks fail", async () => {
      const { doctor } = await import("../../src/commands/doctor.js");
      await expect(doctor(["--json"])).rejects.toThrow(/__exit_1__/);

      const result = stdout.json<{
        summary: { ok: number; warn: number; fail: number; skip: number };
        checks: Array<{ name: string; status: string }>;
      }>();
      expect(result.summary.fail).toBeGreaterThan(0);
      expect(result.checks[0]).toMatchObject({
        name: "config file",
        status: "fail",
      });
    });
  });

  describe("config --json", () => {
    it("emits the full config object", async () => {
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: "z1",
        accountId: "a1",
        tunnelId: "t1",
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["--json"]);

      expect(stdout.json()).toEqual({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: "z1",
        accountId: "a1",
        tunnelId: "t1",
      });
    });

    it("never includes tunnelToken in JSON output", async () => {
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        tunnelToken: "SECRET-DO-NOT-LEAK",
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["--json"]);

      const text = stdout.text();
      expect(text).not.toContain("SECRET-DO-NOT-LEAK");
      expect(text).not.toContain("tunnelToken");
    });

    it("config get --json wraps the value in { key: value }", async () => {
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["get", "domain", "--json"]);

      expect(stdout.json()).toEqual({ domain: "example.com" });
    });

    it("config get --json returns null for unset keys", async () => {
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
      });

      const { config } = await import("../../src/commands/config.js");
      await config(["get", "zoneId", "--json"]);

      expect(stdout.json()).toEqual({ zoneId: null });
    });

    it("config get tunnelToken is rejected", async () => {
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        tunnelToken: "secret",
      });

      const { config } = await import("../../src/commands/config.js");
      await expect(config(["get", "tunnelToken"])).rejects.toThrow(
        /sensitive/
      );
      await expect(config(["get", "tunnelToken", "--json"])).rejects.toThrow(
        /sensitive/
      );
    });
  });

  describe("JSON mode silences human output", () => {
    it("does not emit ANSI/human lines to stdout when --json is set", async () => {
      const zone = addZone(mock.state, "example.com");
      home.writeConfig({
        domain: "example.com",
        devSubdomain: "dev.example.com",
        tunnelName: "dev-example-com",
        zoneId: zone.id,
        accountId: zone.accountId,
      });

      const { list } = await import("../../src/commands/list.js");
      await list(["--json"]);

      const text = stdout.text();
      // Only a single JSON document plus a trailing newline.
      expect(text.trim().startsWith("[")).toBe(true);
      expect(text).not.toContain("\x1b[");
      expect(text).not.toContain("Registered projects");
    });
  });
});
