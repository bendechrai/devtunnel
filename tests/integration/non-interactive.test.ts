import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { startMockCloudflare, addZone, type MockServer } from "../helpers/cf-mock.js";
import { makeIsolatedHome, type IsolatedHome } from "../helpers/config-dir.js";
import { makeTempDir } from "../helpers/temp-dir.js";

// Confirm is mocked in some tests to force non-interactive paths; restartProject
// is always mocked so tests never shell out to docker.
vi.mock("../../src/lib/docker.js", () => ({
  isDockerRunning: vi.fn().mockReturnValue(true),
  isStackRunning: vi.fn().mockReturnValue(false),
  restartProject: vi.fn(),
  composeUp: vi.fn(),
  composeDown: vi.fn(),
}));

interface TtyState {
  stdinWasTTY: boolean | undefined;
  stdoutWasTTY: boolean | undefined;
}

function forceNonTTY(): TtyState {
  const state: TtyState = {
    stdinWasTTY: process.stdin.isTTY,
    stdoutWasTTY: process.stdout.isTTY,
  };
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  return state;
}

function restoreTTY(state: TtyState): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value: state.stdinWasTTY,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: state.stdoutWasTTY,
    configurable: true,
  });
}

describe("add (non-interactive flag handling)", () => {
  let mock: MockServer;
  let home: IsolatedHome;
  let projectDir: ReturnType<typeof makeTempDir>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let tty: TtyState;

  beforeEach(async () => {
    vi.resetModules();
    process.env["CLOUDFLARE_API_TOKEN"] = "test-token";
    mock = startMockCloudflare();
    home = makeIsolatedHome();
    projectDir = makeTempDir("devtun-proj-");
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir.path);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    tty = forceNonTTY();
    const { resetTokenCache } = await import("../../src/lib/token.js");
    resetTokenCache();

    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });
  });

  afterEach(() => {
    mock.server.close();
    home.cleanup();
    projectDir.cleanup();
    cwdSpy.mockRestore();
    logSpy.mockRestore();
    restoreTTY(tty);
    delete process.env["CLOUDFLARE_API_TOKEN"];
  });

  it("non-TTY without restart flag: defaults to no restart (safe default)", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { add } = await import("../../src/commands/add.js");

    await add(["myapp", "web", "3000"]);

    expect(docker.restartProject).not.toHaveBeenCalled();
    expect(existsSync(join(projectDir.path, "docker-compose.override.yml"))).toBe(true);
  });

  it("non-TTY with --no-restart: succeeds, does not restart", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { add } = await import("../../src/commands/add.js");

    await add(["myapp", "web", "3000", "--no-restart"]);

    expect(docker.restartProject).not.toHaveBeenCalled();
    expect(existsSync(join(projectDir.path, "docker-compose.override.yml"))).toBe(true);
  });

  it("non-TTY with --restart: succeeds, restarts", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { add } = await import("../../src/commands/add.js");

    await add(["myapp", "web", "3000", "--restart"]);

    expect(docker.restartProject).toHaveBeenCalledOnce();
  });

  it("non-TTY with --yes: succeeds, restarts", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { add } = await import("../../src/commands/add.js");

    await add(["myapp", "web", "3000", "--yes"]);

    expect(docker.restartProject).toHaveBeenCalledOnce();
  });

  it("non-TTY with -y short alias: restarts", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { add } = await import("../../src/commands/add.js");

    await add(["myapp", "web", "3000", "-y"]);

    expect(docker.restartProject).toHaveBeenCalledOnce();
  });

  it("--no-restart wins over --yes when both supplied", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { add } = await import("../../src/commands/add.js");

    await add(["myapp", "web", "3000", "--yes", "--no-restart"]);

    expect(docker.restartProject).not.toHaveBeenCalled();
  });

  it("accepts flags interleaved with positional args", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { add } = await import("../../src/commands/add.js");

    await add(["--restart", "myapp", "web", "3000"]);

    expect(docker.restartProject).toHaveBeenCalledOnce();
  });

  it("rejects unknown flag with a clear error", async () => {
    const { add } = await import("../../src/commands/add.js");
    await expect(
      add(["myapp", "web", "3000", "--bogus"])
    ).rejects.toThrow(/Unknown flag: --bogus/);
  });
});

describe("remove (non-interactive flag handling)", () => {
  let mock: MockServer;
  let home: IsolatedHome;
  let projectDir: ReturnType<typeof makeTempDir>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let tty: TtyState;

  beforeEach(async () => {
    vi.resetModules();
    process.env["CLOUDFLARE_API_TOKEN"] = "test-token";
    mock = startMockCloudflare();
    home = makeIsolatedHome();
    projectDir = makeTempDir("devtun-proj-");
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir.path);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    tty = forceNonTTY();
    const { resetTokenCache } = await import("../../src/lib/token.js");
    resetTokenCache();

    const zone = addZone(mock.state, "example.com");
    home.writeConfig({
      domain: "example.com",
      devSubdomain: "dev.example.com",
      tunnelName: "dev-example-com",
      zoneId: zone.id,
      accountId: zone.accountId,
    });
  });

  afterEach(() => {
    mock.server.close();
    home.cleanup();
    projectDir.cleanup();
    cwdSpy.mockRestore();
    logSpy.mockRestore();
    restoreTTY(tty);
    delete process.env["CLOUDFLARE_API_TOKEN"];
  });

  it("non-TTY without restart flag: defaults to no restart (safe default)", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { remove } = await import("../../src/commands/remove.js");

    await remove(["myapp"]);

    expect(docker.restartProject).not.toHaveBeenCalled();
  });

  it("non-TTY with --no-restart: succeeds silently", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { remove } = await import("../../src/commands/remove.js");

    await remove(["myapp", "--no-restart"]);

    expect(docker.restartProject).not.toHaveBeenCalled();
  });

  it("non-TTY with --yes: succeeds, restarts", async () => {
    const docker = await import("../../src/lib/docker.js");
    const { remove } = await import("../../src/commands/remove.js");

    await remove(["myapp", "--yes"]);

    expect(docker.restartProject).toHaveBeenCalledOnce();
  });
});
