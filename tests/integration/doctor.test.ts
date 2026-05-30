import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startMockCloudflare, addZone, type MockServer } from "../helpers/cf-mock.js";
import { makeIsolatedHome, type IsolatedHome } from "../helpers/config-dir.js";

vi.mock("../../src/lib/docker.js", () => ({
  isDockerRunning: vi.fn().mockReturnValue(true),
  isStackRunning: vi.fn().mockReturnValue(true),
  restartProject: vi.fn(),
  composeUp: vi.fn(),
  composeDown: vi.fn(),
}));

describe("doctor command (integration)", () => {
  let mock: MockServer;
  let home: IsolatedHome;
  let stdout: string[];
  let stderr: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    process.env["CLOUDFLARE_API_TOKEN"] = "test-token";
    mock = startMockCloudflare();
    home = makeIsolatedHome();
    stdout = [];
    stderr = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      stdout.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      stderr.push(args.join(" "));
    });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`__exit_${code ?? 0}__`);
    });
    const { resetTokenCache } = await import("../../src/lib/token.js");
    resetTokenCache();
  });

  afterEach(() => {
    mock.server.close();
    home.cleanup();
    vi.restoreAllMocks();
    delete process.env["CLOUDFLARE_API_TOKEN"];
    exitSpy.mockRestore();
  });

  function all(): string {
    return [...stdout, ...stderr].join("\n");
  }

  it("reports OK across the board for a healthy setup", async () => {
    const zone = addZone(mock.state, "example.com");
    const account = mock.state.accounts.get(zone.accountId);
    if (!account) throw new Error("account not seeded");
    account.tunnels.set("tunnel-1", {
      id: "tunnel-1",
      name: "dev-example-com",
      status: "healthy",
      created_at: new Date().toISOString(),
    });
    zone.fallbackOrigin = { origin: "tunnel-origin.example.com", status: "active" };
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
      tunnelId: "tunnel-1",
    });

    const { doctor } = await import("../../src/commands/doctor.js");
    await doctor();

    const output = all();
    expect(output).toContain("[OK] config file");
    expect(output).toContain("[OK] cloudflare token");
    expect(output).toContain("[OK] zone access");
    expect(output).toContain("[OK] tunnel");
    expect(output).toContain("[OK] cloudflare for SaaS");
    expect(output).toContain("[OK] fallback origin");
    expect(output).toContain("[OK] custom hostnames");
    expect(output).toContain("[OK] docker");
    expect(output).toContain("[OK] devtun stack");
    expect(output).toMatch(/9 ok, 0 warning/);
  });

  it("warns when stored zoneId is stale", async () => {
    const zone = addZone(mock.state, "example.com");
    // Seed tunnel and fallback so zone-mismatch is the ONLY interesting signal.
    const account = mock.state.accounts.get(zone.accountId);
    if (!account) throw new Error("account not seeded");
    account.tunnels.set("tunnel-1", {
      id: "tunnel-1",
      name: "dev-example-com",
      status: "healthy",
      created_at: new Date().toISOString(),
    });
    zone.fallbackOrigin = { origin: "tunnel-origin.example.com", status: "active" };

    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: "wrong-zone-id",
      accountId: zone.accountId,
      tunnelId: "tunnel-1",
    });

    const { doctor } = await import("../../src/commands/doctor.js");
    await doctor();

    expect(all()).toContain("[WARN] zone access");
  });

  it("flags orphan hostnames on a subdomain that does not match devSubdomain", async () => {
    const zone = addZone(mock.state, "example.com");
    zone.fallbackOrigin = { origin: "tunnel-origin.example.com", status: "active" };
    const account = mock.state.accounts.get(zone.accountId);
    if (!account) throw new Error("account not seeded");
    account.tunnels.set("tunnel-1", {
      id: "tunnel-1",
      name: "dev-example-com",
      status: "healthy",
      created_at: new Date().toISOString(),
    });
    // One matching + one orphan
    zone.customHostnames.set("ch1", {
      id: "ch1",
      hostname: "myapp.dev.example.com",
      status: "active",
      created_at: new Date().toISOString(),
      ssl: { status: "active", method: "http", type: "dv" },
    });
    zone.customHostnames.set("ch2", {
      id: "ch2",
      hostname: "leftover.preview.example.com",
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
      tunnelId: "tunnel-1",
    });

    const { doctor } = await import("../../src/commands/doctor.js");
    await doctor();

    const output = all();
    expect(output).toContain("[WARN] custom hostnames");
    expect(output).toContain("leftover.preview.example.com");
  });

  it("fails on missing config and exits 1", async () => {
    const { doctor } = await import("../../src/commands/doctor.js");
    await expect(doctor()).rejects.toThrow(/__exit_1__/);
    expect(all()).toContain("[FAIL] config file");
  });

  it("fails on bad token and continues to docker check", async () => {
    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });
    mock.state.rejectAuth = true;

    const { doctor } = await import("../../src/commands/doctor.js");
    await expect(doctor()).rejects.toThrow(/__exit_1__/);

    const output = all();
    expect(output).toContain("[FAIL] zone access");
    expect(output).toContain("[SKIP]");
    expect(output).toContain("[OK] docker");
  });

  it("warns when devtun stack is not running", async () => {
    const zone = addZone(mock.state, "example.com");
    zone.fallbackOrigin = { origin: "tunnel-origin.example.com", status: "active" };
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

    const docker = await import("../../src/lib/docker.js");
    vi.mocked(docker.isStackRunning).mockReturnValue(false);

    const { doctor } = await import("../../src/commands/doctor.js");
    await doctor();

    expect(all()).toContain("[WARN] devtun stack");
  });

  it("fails when fallback origin is misconfigured", async () => {
    const zone = addZone(mock.state, "example.com");
    const account = mock.state.accounts.get(zone.accountId);
    if (!account) throw new Error("account not seeded");
    account.tunnels.set("tunnel-1", {
      id: "tunnel-1",
      name: "dev-example-com",
      status: "healthy",
      created_at: new Date().toISOString(),
    });
    // Fallback set to the wrong origin
    zone.fallbackOrigin = { origin: "wrong-origin.example.com", status: "active" };
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
      tunnelId: "tunnel-1",
    });

    const { doctor } = await import("../../src/commands/doctor.js");
    await doctor();

    expect(all()).toContain("[WARN] fallback origin");
  });

  it("flags wrong tunnel ID in config vs Cloudflare", async () => {
    const zone = addZone(mock.state, "example.com");
    zone.fallbackOrigin = { origin: "tunnel-origin.example.com", status: "active" };
    const account = mock.state.accounts.get(zone.accountId);
    if (!account) throw new Error("account not seeded");
    account.tunnels.set("tunnel-real", {
      id: "tunnel-real",
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
      tunnelId: "tunnel-stale",
    });

    const { doctor } = await import("../../src/commands/doctor.js");
    await doctor();

    expect(all()).toContain("[WARN] tunnel");
  });
});
