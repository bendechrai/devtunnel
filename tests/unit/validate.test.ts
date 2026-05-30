import { describe, it, expect } from "vitest";
import { validateProjectName } from "../../src/lib/validate.js";

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
