import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { captureStdout, type StdoutCapture } from "../helpers/capture-stdout.js";

describe("--help on every command", () => {
  let stdout: StdoutCapture;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    stdout = captureStdout();
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      // Help uses console.log, not process.stdout.write directly. Capture both.
      stdout.chunks.push(args.join(" ") + "\n");
    });
    const out = await import("../../src/lib/output.js");
    out.setJsonMode(false);
  });

  afterEach(() => {
    stdout.restore();
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });

  const commands: Array<{ name: string; loader: () => Promise<(args: string[]) => Promise<void>> }> = [
    { name: "add", loader: async () => (await import("../../src/commands/add.js")).add },
    { name: "remove", loader: async () => (await import("../../src/commands/remove.js")).remove },
    { name: "list", loader: async () => (await import("../../src/commands/list.js")).list },
    { name: "status", loader: async () => (await import("../../src/commands/status.js")).status },
    { name: "doctor", loader: async () => (await import("../../src/commands/doctor.js")).doctor },
    { name: "config", loader: async () => (await import("../../src/commands/config.js")).config },
    { name: "setup", loader: async () => (await import("../../src/commands/setup.js")).setup },
    { name: "up", loader: async () => (await import("../../src/commands/up.js")).up },
    { name: "down", loader: async () => (await import("../../src/commands/down.js")).down },
    { name: "autostart", loader: async () => (await import("../../src/commands/autostart.js")).autostart },
  ];

  for (const { name, loader } of commands) {
    it(`devtun ${name} --help prints help with required sections`, async () => {
      const cmd = await loader();
      await cmd(["--help"]);
      const text = stdout.text();
      expect(text).toContain(`devtun ${name}`);
      expect(text).toContain("SYNOPSIS");
      expect(text).toContain("DESCRIPTION");
      expect(text).toContain("EXIT CODES");
      expect(text).toContain("EXAMPLES");
    });

    it(`devtun ${name} -h also prints help`, async () => {
      const cmd = await loader();
      await cmd(["-h"]);
      expect(stdout.text()).toContain(`devtun ${name}`);
    });
  }

  it("--json --help returns the HelpDoc as JSON", async () => {
    const { add } = await import("../../src/commands/add.js");
    await add(["--json", "--help"]);
    const doc = stdout.json<{
      command: string;
      synopsis: string;
      description: string;
      args: unknown[];
      flags: unknown[];
      examples: unknown[];
    }>();
    expect(doc.command).toBe("add");
    expect(doc.synopsis).toContain("devtun add");
    expect(Array.isArray(doc.args)).toBe(true);
    expect(Array.isArray(doc.flags)).toBe(true);
    expect(Array.isArray(doc.examples)).toBe(true);
  });
});
