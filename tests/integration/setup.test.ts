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

interface TtyState {
  stdin: boolean | undefined;
  stdout: boolean | undefined;
}

function forceNonTTY(): TtyState {
  const state = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  return state;
}

function restoreTTY(state: TtyState): void {
  Object.defineProperty(process.stdin, "isTTY", { value: state.stdin, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: state.stdout, configurable: true });
}

describe("setup (non-interactive)", () => {
  let mock: MockServer;
  let home: IsolatedHome;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let tty: TtyState;

  beforeEach(async () => {
    vi.resetModules();
    process.env["CLOUDFLARE_API_TOKEN"] = "test-token";
    delete process.env["DEVTUN_DOMAIN"];
    delete process.env["DEVTUN_DEV_SUBDOMAIN"];
    delete process.env["DEVTUN_TUNNEL_NAME"];
    mock = startMockCloudflare();
    home = makeIsolatedHome();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: number): never => {
        throw new Error(`__exit_${code ?? 0}__`);
      });
    tty = forceNonTTY();
    const { resetTokenCache } = await import("../../src/lib/token.js");
    resetTokenCache();
  });

  afterEach(() => {
    mock.server.close();
    home.cleanup();
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    restoreTTY(tty);
    delete process.env["CLOUDFLARE_API_TOKEN"];
  });

  it("runs end-to-end with all flags provided (no prompts)", async () => {
    addZone(mock.state, "example.com", { saasEnabled: true });

    const { setup } = await import("../../src/commands/setup.js");
    await setup([
      "--domain", "example.com",
      "--dev-subdomain", "dev.example.com",
      "--tunnel-name", "dev-example-com",
      "--yes",
    ]);

    const cfg = home.readConfig();
    expect(cfg.domain).toBe("example.com");
    expect(cfg.devSubdomain).toBe("dev.example.com");
    expect(cfg.tunnelName).toBe("dev-example-com");
    expect(cfg.zoneId).toBeTruthy();
    expect(cfg.accountId).toBeTruthy();
    expect(cfg.tunnelId).toBeTruthy();
    expect(cfg.tunnelToken).toBeTruthy();
  });

  it("picks values up from DEVTUN_* env vars", async () => {
    addZone(mock.state, "example.com", { saasEnabled: true });
    process.env["DEVTUN_DOMAIN"] = "example.com";
    process.env["DEVTUN_DEV_SUBDOMAIN"] = "dev.example.com";
    process.env["DEVTUN_TUNNEL_NAME"] = "dev-example-com";

    const { setup } = await import("../../src/commands/setup.js");
    await setup(["--yes"]);

    const cfg = home.readConfig();
    expect(cfg.domain).toBe("example.com");
    expect(cfg.devSubdomain).toBe("dev.example.com");
    expect(cfg.tunnelName).toBe("dev-example-com");
  });

  it("fails clearly when domain is missing in non-TTY mode", async () => {
    const { setup } = await import("../../src/commands/setup.js");
    await expect(setup(["--yes"])).rejects.toThrow(
      /Missing required value 'domain' in non-interactive mode/
    );
  });

  it("dev-subdomain defaults to dev.<domain> when flag/env not given", async () => {
    addZone(mock.state, "example.com", { saasEnabled: true });

    const { setup } = await import("../../src/commands/setup.js");
    await setup(["--domain", "example.com", "--yes"]);

    const cfg = home.readConfig();
    expect(cfg.devSubdomain).toBe("dev.example.com");
    expect(cfg.tunnelName).toBe("dev-example-com");
  });

  it("exits 2 with dashboard URL when SaaS is not enabled (non-TTY)", async () => {
    addZone(mock.state, "example.com", { saasEnabled: false });

    const { setup } = await import("../../src/commands/setup.js");
    await expect(
      setup([
        "--domain", "example.com",
        "--dev-subdomain", "dev.example.com",
        "--yes",
      ])
    ).rejects.toThrow(/__exit_2__/);
  });

  it("re-running on an existing config is idempotent (uses existing values)", async () => {
    const zone = addZone(mock.state, "example.com", { saasEnabled: true });
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });

    const { setup } = await import("../../src/commands/setup.js");
    await setup(["--yes"]);

    const cfg = home.readConfig();
    expect(cfg.domain).toBe("example.com");
    expect(cfg.tunnelId).toBeTruthy();
  });

  it("sets up a named instance without touching the default instance", async () => {
    const zone = addZone(mock.state, "other.com", { saasEnabled: true });
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
    });

    const { setup } = await import("../../src/commands/setup.js");
    await setup([
      "-i", "alt",
      "--domain", "other.com",
      "--dev-subdomain", "dev.other.com",
      "--docker-socket", "/var/run/docker-lightsout.sock",
      "--yes",
    ]);

    // Named instance config lands in instances/alt, default untouched.
    const altCfg = home.readConfig("alt");
    expect(altCfg.domain).toBe("other.com");
    expect(altCfg.devSubdomain).toBe("dev.other.com");
    expect(altCfg.tunnelName).toBe("dev-other-com-alt");
    expect(altCfg.dockerSocket).toBe("/var/run/docker-lightsout.sock");
    expect(altCfg.tunnelId).toBeTruthy();

    const defaultCfg = home.readConfig();
    expect(defaultCfg.domain).toBe("example.com");
    expect(defaultCfg.tunnelId).toBeUndefined();

    // Tunnel ingress targets the instance's traefik container.
    const account = mock.state.accounts.get(zone.accountId);
    if (!account) throw new Error("account not seeded");
    const tunnelConfig = account.tunnelConfigs.get(altCfg.tunnelId!) as {
      config: { ingress: Array<{ hostname?: string; service: string }> };
    };
    expect(tunnelConfig.config.ingress[0]).toEqual({
      hostname: "*.dev.other.com",
      service: "http://alt-traefik:80",
    });
  });

  it("rejects reserved instance names", async () => {
    const { setup } = await import("../../src/commands/setup.js");
    await expect(setup(["-i", "docker0", "--yes"])).rejects.toThrow(/reserved/);
  });
});
