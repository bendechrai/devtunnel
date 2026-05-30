import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import {
  addOverrideLabels,
  removeOverrideLabels,
  readOverrideMappings,
} from "../../src/lib/compose.js";
import { makeTempDir } from "../helpers/temp-dir.js";

describe("compose: addOverrideLabels", () => {
  let dir: ReturnType<typeof makeTempDir>;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => dir.cleanup());

  it("creates a new override file from scratch", () => {
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
    });

    const overridePath = join(dir.path, "docker-compose.override.yml");
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
    expect(parsed.services.web.labels["traefik.http.routers.myapp.entrypoints"]).toBe(
      "web"
    );
    expect(parsed.services.web.networks).toContain("devtun");
    expect(parsed.networks.devtun.external).toBe(true);
  });

  it("merges into an existing service without clobbering non-traefik labels", () => {
    writeFileSync(
      join(dir.path, "docker-compose.override.yml"),
      `services:
  web:
    labels:
      com.example.team: platform
      com.example.cost-center: "42"
    environment:
      - NODE_ENV=development
`
    );

    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
    });

    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.override.yml"), "utf-8")
    );
    expect(parsed.services.web.labels["com.example.team"]).toBe("platform");
    expect(parsed.services.web.labels["com.example.cost-center"]).toBe("42");
    expect(parsed.services.web.labels["traefik.enable"]).toBe("true");
    expect(parsed.services.web.environment).toEqual(["NODE_ENV=development"]);
  });

  it("supports multiple routers on the same project (different services)", () => {
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
    });
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "mail",
      hostname: "myapp-mail.dev.example.com",
      routerName: "myapp-mail",
      port: 8025,
    });

    const mappings = readOverrideMappings(dir.path);
    expect(mappings).toHaveLength(2);
    expect(mappings).toContainEqual({
      routerName: "myapp",
      serviceName: "web",
      port: 3000,
    });
    expect(mappings).toContainEqual({
      routerName: "myapp-mail",
      serviceName: "mail",
      port: 8025,
    });
  });

  it("adds devtun to existing service networks list without duplicating", () => {
    writeFileSync(
      join(dir.path, "docker-compose.override.yml"),
      `services:
  web:
    networks:
      - default
      - devtun
`
    );

    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
    });

    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.override.yml"), "utf-8")
    );
    const networks = parsed.services.web.networks;
    expect(networks.filter((n: string) => n === "devtun")).toHaveLength(1);
    expect(networks).toContain("default");
  });
});

describe("compose: removeOverrideLabels", () => {
  let dir: ReturnType<typeof makeTempDir>;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => dir.cleanup());

  it("removes labels for the named router and cleans up empty service", () => {
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
    });

    removeOverrideLabels(dir.path, "myapp");

    // File should be deleted since nothing was preserved
    expect(existsSync(join(dir.path, "docker-compose.override.yml"))).toBe(false);
  });

  it("preserves user-authored labels and other services", () => {
    writeFileSync(
      join(dir.path, "docker-compose.override.yml"),
      `services:
  web:
    labels:
      com.example.team: platform
    environment:
      - NODE_ENV=development
  worker:
    image: redis:7
`
    );

    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
    });

    removeOverrideLabels(dir.path, "myapp");

    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.override.yml"), "utf-8")
    );
    expect(parsed.services.web.labels["com.example.team"]).toBe("platform");
    expect(parsed.services.web.labels["traefik.enable"]).toBeUndefined();
    expect(parsed.services.web.environment).toEqual(["NODE_ENV=development"]);
    expect(parsed.services.worker.image).toBe("redis:7");
    expect(parsed.networks).toBeUndefined();
  });

  it("only removes the targeted router when two are present on the same service", () => {
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
    });
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp-admin.dev.example.com",
      routerName: "myapp-admin",
      port: 3001,
    });

    removeOverrideLabels(dir.path, "myapp");

    const mappings = readOverrideMappings(dir.path);
    expect(mappings).toEqual([
      { routerName: "myapp-admin", serviceName: "web", port: 3001 },
    ]);
  });

  it("is a no-op when override file does not exist", () => {
    expect(() => removeOverrideLabels(dir.path, "doesnotexist")).not.toThrow();
  });
});

describe("compose: readOverrideMappings", () => {
  let dir: ReturnType<typeof makeTempDir>;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => dir.cleanup());

  it("returns empty array when no override file exists", () => {
    expect(readOverrideMappings(dir.path)).toEqual([]);
  });

  it("returns empty array when override has no services", () => {
    writeFileSync(
      join(dir.path, "docker-compose.override.yml"),
      "networks:\n  devtun:\n    external: true\n"
    );
    expect(readOverrideMappings(dir.path)).toEqual([]);
  });
});
