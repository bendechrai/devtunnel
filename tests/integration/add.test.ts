import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "fs";
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

describe("add command (integration)", () => {
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

  it("creates DNS record + custom hostname on Cloudflare and writes override file", async () => {
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

    // Cloudflare side
    const dns = [...zone.dnsRecords.values()];
    expect(dns).toHaveLength(1);
    expect(dns[0].name).toBe("myapp.dev.example.com");
    expect(dns[0].type).toBe("CNAME");
    expect(dns[0].content).toBe("tunnel-origin.example.com");
    expect(dns[0].proxied).toBe(true);

    const hostnames = [...zone.customHostnames.values()];
    expect(hostnames).toHaveLength(1);
    expect(hostnames[0].hostname).toBe("myapp.dev.example.com");

    // Local file
    const overridePath = join(projectDir.path, "docker-compose.override.yml");
    expect(existsSync(overridePath)).toBe(true);
    const parsed = parseYaml(readFileSync(overridePath, "utf-8"));
    expect(parsed.services.web.labels["traefik.enable"]).toBe("true");
    expect(parsed.services.web.labels["traefik.http.routers.myapp.rule"]).toBe(
      "Host(`myapp.dev.example.com`)"
    );
    expect(
      parsed.services.web.labels[
        "traefik.http.services.myapp.loadbalancer.server.port"
      ]
    ).toBe("3000");
  });

  it("does not create a duplicate DNS record if one already exists", async () => {
    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });

    // Pre-existing CNAME
    zone.dnsRecords.set("pre", {
      id: "pre",
      type: "CNAME",
      name: "myapp.dev.example.com",
      content: "tunnel-origin.example.com",
      proxied: true,
      ttl: 1,
    });

    const { add } = await import("../../src/commands/add.js");
    await add(["myapp", "web", "3000"]);

    const dns = [...zone.dnsRecords.values()];
    expect(dns).toHaveLength(1);
    expect(dns[0].id).toBe("pre");
  });

  it("rejects invalid project name", async () => {
    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });

    const { add } = await import("../../src/commands/add.js");
    await expect(add(["My_App", "web", "3000"])).rejects.toThrow(/Invalid project name/);
    // No CF or filesystem side effects
    expect([...zone.dnsRecords.values()]).toHaveLength(0);
    expect(existsSync(join(projectDir.path, "docker-compose.override.yml"))).toBe(false);
  });

  it("rejects out-of-range port", async () => {
    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });

    const { add } = await import("../../src/commands/add.js");
    await expect(add(["myapp", "web", "99999"])).rejects.toThrow(/Invalid port/);
  });

  it("requires all three arguments", async () => {
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
    });

    const { add } = await import("../../src/commands/add.js");
    await expect(add([])).rejects.toThrow(/Usage/);
    await expect(add(["myapp"])).rejects.toThrow(/Usage/);
    await expect(add(["myapp", "web"])).rejects.toThrow(/Usage/);
  });
});
