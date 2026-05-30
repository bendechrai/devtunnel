import { describe, it, expect } from "vitest";
import { parseFlags } from "../../src/lib/flags.js";

describe("parseFlags", () => {
  it("returns empty result for empty input", () => {
    expect(parseFlags([])).toEqual({ positional: [], flags: {} });
  });

  it("collects positional arguments", () => {
    expect(parseFlags(["one", "two", "three"])).toEqual({
      positional: ["one", "two", "three"],
      flags: {},
    });
  });

  it("--foo sets boolean true", () => {
    const out = parseFlags(["--yes"], { boolean: ["yes"] });
    expect(out.flags).toEqual({ yes: true });
  });

  it("--no-foo sets boolean false", () => {
    const out = parseFlags(["--no-restart"], { boolean: ["restart"] });
    expect(out.flags).toEqual({ restart: false });
  });

  it("--foo=bar sets string value", () => {
    const out = parseFlags(["--domain=example.com"], { string: ["domain"] });
    expect(out.flags).toEqual({ domain: "example.com" });
  });

  it("--foo bar (space-separated) sets string value", () => {
    const out = parseFlags(["--domain", "example.com"], { string: ["domain"] });
    expect(out.flags).toEqual({ domain: "example.com" });
  });

  it("-f resolves alias to boolean", () => {
    const out = parseFlags(["-y"], {
      boolean: ["yes"],
      aliases: { y: "yes" },
    });
    expect(out.flags).toEqual({ yes: true });
  });

  it("-- terminates flag parsing", () => {
    const out = parseFlags(["--yes", "--", "--not-a-flag", "value"], {
      boolean: ["yes"],
    });
    expect(out).toEqual({
      positional: ["--not-a-flag", "value"],
      flags: { yes: true },
    });
  });

  it("mixes positional and flags in any order", () => {
    const out = parseFlags(["myapp", "--yes", "web", "3000", "--no-restart"], {
      boolean: ["yes", "restart"],
    });
    expect(out).toEqual({
      positional: ["myapp", "web", "3000"],
      flags: { yes: true, restart: false },
    });
  });

  it("throws on unknown flag", () => {
    expect(() => parseFlags(["--bogus"], { boolean: ["yes"] })).toThrow(
      /Unknown flag: --bogus/
    );
  });

  it("throws on unknown short flag", () => {
    expect(() => parseFlags(["-x"], { boolean: ["yes"], aliases: { y: "yes" } })).toThrow(
      /Unknown flag: -x/
    );
  });

  it("throws when --no-foo names a non-boolean", () => {
    expect(() => parseFlags(["--no-domain"], { string: ["domain"] })).toThrow(
      /Unknown flag: --no-domain/
    );
  });

  it("throws when string flag is missing value", () => {
    expect(() => parseFlags(["--domain"], { string: ["domain"] })).toThrow(
      /requires a value/
    );
  });

  it("throws when string flag is followed by another flag", () => {
    expect(() =>
      parseFlags(["--domain", "--yes"], { string: ["domain"], boolean: ["yes"] })
    ).toThrow(/requires a value/);
  });

  it("treats a lone hyphen as positional", () => {
    expect(parseFlags(["-"])).toEqual({ positional: ["-"], flags: {} });
  });

  it("supports aliases for string flags", () => {
    const out = parseFlags(["-d", "example.com"], {
      string: ["domain"],
      aliases: { d: "domain" },
    });
    expect(out.flags).toEqual({ domain: "example.com" });
  });
});
