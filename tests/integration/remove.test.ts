import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { startMockCloudflare, addZone, type MockServer } from "../helpers/cf-mock.js";
import { makeIsolatedHome, type IsolatedHome } from "../helpers/config-dir.js";
import { makeTempDir } from "../helpers/temp-dir.js";

vi.mock("../../src/lib/prompt.js", () => ({
  confirm: vi.fn().mockResolvedValue(false),
  ask: vi.fn(),
  waitForEnter: vi.fn(),
}));

vi.mock("../../src/lib/docker.js", () => ({
  isDockerRunning: vi.fn().mockReturnValue(true),
  isStackRunning: vi.fn().mockReturnValue(false),
  restartProject: vi.fn(),
  composeUp: vi.fn(),
  composeDown: vi.fn(),
}));

describe("remove command (integration)", () => {
  let mock: MockServer;
  let home: IsolatedHome;
  let projectDir: ReturnType<typeof makeTempDir>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    process.env["CLOUDFLARE_API_TOKEN"] = "test-token";
    mock = startMockCloudflare();
    home = makeIsolatedHome();
    projectDir = makeTempDir("devtun-proj-");
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir.path);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { resetTokenCache } = await import("../../src/lib/token.js");
    resetTokenCache();
  });

  afterEach(() => {
    mock.server.close();
    home.cleanup();
    projectDir.cleanup();
    cwdSpy.mockRestore();
    logSpy.mockRestore();
    delete process.env["CLOUDFLARE_API_TOKEN"];
  });

  it("removes custom hostname, DNS record, and override file", async () => {
    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });

    const { add } = await import("../../src/commands/add.js");
    await add(["myapp", "web", "3000"]);

    expect([...zone.dnsRecords.values()]).toHaveLength(1);
    expect([...zone.customHostnames.values()]).toHaveLength(1);
    expect(existsSync(join(projectDir.path, "docker-compose.override.yml"))).toBe(true);

    const { remove } = await import("../../src/commands/remove.js");
    await remove(["myapp"]);

    expect([...zone.dnsRecords.values()]).toHaveLength(0);
    expect([...zone.customHostnames.values()]).toHaveLength(0);
    expect(existsSync(join(projectDir.path, "docker-compose.override.yml"))).toBe(false);
  });

  it("removes TXT ownership-verification record if present", async () => {
    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });

    // Set up a TXT record as if a previous add had added one
    zone.dnsRecords.set("txt1", {
      id: "txt1",
      type: "TXT",
      name: "_cf-custom-hostname.myapp.dev.example.com",
      content: "verification-value",
      proxied: false,
      ttl: 1,
    });
    zone.customHostnames.set("ch1", {
      id: "ch1",
      hostname: "myapp.dev.example.com",
      status: "pending",
      created_at: new Date().toISOString(),
      ssl: { status: "pending_validation", method: "http", type: "dv" },
    });

    const { remove } = await import("../../src/commands/remove.js");
    await remove(["myapp"]);

    expect([...zone.dnsRecords.values()]).toHaveLength(0);
    expect([...zone.customHostnames.values()]).toHaveLength(0);
  });

  it("preserves other projects when removing one of two", async () => {
    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });

    const { add } = await import("../../src/commands/add.js");
    await add(["myapp", "web", "3000"]);
    await add(["myapp-mail", "mail", "8025"]);

    const { remove } = await import("../../src/commands/remove.js");
    await remove(["myapp"]);

    const remaining = [...zone.customHostnames.values()];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].hostname).toBe("myapp-mail.dev.example.com");

    const overridePath = join(projectDir.path, "docker-compose.override.yml");
    expect(existsSync(overridePath)).toBe(true);
    const parsed = parseYaml(readFileSync(overridePath, "utf-8"));
    expect(parsed.services.mail).toBeDefined();
    expect(parsed.services.web).toBeUndefined();
  });

  it("succeeds even if Cloudflare hostname is already gone", async () => {
    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });

    const { remove } = await import("../../src/commands/remove.js");
    await expect(remove(["myapp"])).resolves.not.toThrow();
  });

  it("requires a project name", async () => {
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
    });

    const { remove } = await import("../../src/commands/remove.js");
    await expect(remove([])).rejects.toThrow(/Usage/);
  });
});
