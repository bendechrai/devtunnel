import { describe, it, expect } from "vitest";
import { validateProjectName, validateFqdn } from "../../src/lib/validate.js";

describe("validateProjectName", () => {
  it.each(["myapp", "my-app", "a", "a1", "0app", "my-app-123"])(
    "accepts valid name: %s",
    (name) => {
      expect(() => validateProjectName(name)).not.toThrow();
    }
  );

  it.each([
    ["MyApp", "uppercase"],
    ["my_app", "underscore"],
    ["my app", "space"],
    ["-myapp", "leading hyphen"],
    ["myapp-", "trailing hyphen"],
    ["", "empty"],
    ["my.app", "dot"],
  ])("rejects invalid name %j (%s)", (name) => {
    expect(() => validateProjectName(name)).toThrow();
  });

  it("rejects names over 63 characters with a length-specific error", () => {
    const name = "a".repeat(64);
    expect(() => validateProjectName(name)).toThrow(/63/);
  });

  it("accepts exactly 63 characters", () => {
    const name = "a".repeat(63);
    expect(() => validateProjectName(name)).not.toThrow();
  });
});

describe("validateFqdn", () => {
  it("accepts a hostname within the zone", () => {
    expect(() => validateFqdn("app.holodeck.build", "holodeck.build")).not.toThrow();
    expect(() => validateFqdn("a.b.holodeck.build", "holodeck.build")).not.toThrow();
  });

  it("accepts the apex domain itself", () => {
    expect(() => validateFqdn("holodeck.build", "holodeck.build")).not.toThrow();
  });

  it("rejects a hostname outside the zone", () => {
    expect(() => validateFqdn("app.vennlabs.dev", "holodeck.build")).toThrow(/not within/);
    // Suffix look-alike must not pass (evil-holodeck.build is not under holodeck.build).
    expect(() => validateFqdn("evilholodeck.build", "holodeck.build")).toThrow(/not within/);
  });

  it("rejects malformed hostnames", () => {
    for (const bad of ["App.holodeck.build", "app_.holodeck.build", "app..holodeck.build", "-app.holodeck.build", ""]) {
      expect(() => validateFqdn(bad, "holodeck.build")).toThrow();
    }
  });
});
