import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import {
  addOverrideLabels,
  removeOverrideLabels,
  readOverrideMappings,
  writeInfraCompose,
  checkComposeSocketDrift,
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
      networkName: "devtun",
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
      networkName: "devtun",
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
      networkName: "devtun",
    });
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "mail",
      hostname: "myapp-mail.dev.example.com",
      routerName: "myapp-mail",
      port: 8025,
      networkName: "devtun",
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

  it("default cache mode injects CDN + browser Cache-Control no-store headers", () => {
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
      networkName: "devtun",
    });

    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.override.yml"), "utf-8")
    );
    const labels = parsed.services.web.labels;
    expect(
      labels[
        "traefik.http.middlewares.myapp-nocache.headers.customresponseheaders.CDN-Cache-Control"
      ]
    ).toBe("no-store");
    expect(
      labels[
        "traefik.http.middlewares.myapp-nocache.headers.customresponseheaders.Cache-Control"
      ]
    ).toBe("no-store, no-cache, must-revalidate, max-age=0");
    expect(labels["traefik.http.routers.myapp.middlewares"]).toBe("myapp-nocache");
  });

  it("cache=cdn omits the browser Cache-Control header", () => {
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
      networkName: "devtun",
      cache: "cdn",
    });

    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.override.yml"), "utf-8")
    );
    const labels = parsed.services.web.labels;
    expect(
      labels[
        "traefik.http.middlewares.myapp-nocache.headers.customresponseheaders.CDN-Cache-Control"
      ]
    ).toBe("no-store");
    expect(
      labels[
        "traefik.http.middlewares.myapp-nocache.headers.customresponseheaders.Cache-Control"
      ]
    ).toBeUndefined();
    expect(labels["traefik.http.routers.myapp.middlewares"]).toBe("myapp-nocache");
  });

  it("cache=none emits no middleware labels at all", () => {
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
      networkName: "devtun",
      cache: "none",
    });

    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.override.yml"), "utf-8")
    );
    const labels = parsed.services.web.labels;
    expect(labels["traefik.http.routers.myapp.middlewares"]).toBeUndefined();
    const middlewareKeys = Object.keys(labels).filter((k) =>
      k.startsWith("traefik.http.middlewares.")
    );
    expect(middlewareKeys).toEqual([]);
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
      networkName: "devtun",
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
      networkName: "devtun",
    });

    removeOverrideLabels(dir.path, "myapp", "devtun");

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
      networkName: "devtun",
    });

    removeOverrideLabels(dir.path, "myapp", "devtun");

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
      networkName: "devtun",
    });
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp-admin.dev.example.com",
      routerName: "myapp-admin",
      port: 3001,
      networkName: "devtun",
    });

    removeOverrideLabels(dir.path, "myapp", "devtun");

    const mappings = readOverrideMappings(dir.path);
    expect(mappings).toEqual([
      { routerName: "myapp-admin", serviceName: "web", port: 3001 },
    ]);
  });

  it("is a no-op when override file does not exist", () => {
    expect(() => removeOverrideLabels(dir.path, "doesnotexist", "devtun")).not.toThrow();
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

describe("compose: writeInfraCompose", () => {
  let dir: ReturnType<typeof makeTempDir>;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => dir.cleanup());

  const baseConfig = {
    domain: "example.com",
    devSubdomain: "dev.example.com",
    tunnelName: "dev-example-com",
  };

  function inst(name: string) {
    return { name, dir: dir.path, isDefault: name === "devtun" };
  }

  it("generates the default instance with devtun names and no published ports", () => {
    writeInfraCompose(inst("devtun"), baseConfig);
    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.yml"), "utf-8")
    );
    expect(parsed.name).toBe("devtun");
    expect(parsed.services.traefik.container_name).toBe("devtun-traefik");
    expect(parsed.services.tunnel.container_name).toBe("devtun-tunnel");
    expect(parsed.services.traefik.ports).toBeUndefined();
    expect(parsed.services.traefik.command).toContain(
      "--providers.docker.network=devtun"
    );
    expect(parsed.services.traefik.command).not.toContain("--api.insecure=true");
    expect(parsed.services.traefik.volumes).toEqual([
      "/var/run/docker.sock:/var/run/docker.sock:ro",
    ]);
    expect(parsed.networks.devtun.name).toBe("devtun");
  });

  it("parameterizes container names, network, and socket for a named instance", () => {
    writeInfraCompose(inst("alt"), {
      ...baseConfig,
      dockerSocket: "/var/run/docker-lightsout.sock",
    });
    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.yml"), "utf-8")
    );
    expect(parsed.name).toBe("alt");
    expect(parsed.services.traefik.container_name).toBe("alt-traefik");
    expect(parsed.services.tunnel.container_name).toBe("alt-tunnel");
    expect(parsed.services.traefik.command).toContain(
      "--providers.docker.network=alt"
    );
    expect(parsed.services.traefik.volumes).toEqual([
      "/var/run/docker-lightsout.sock:/var/run/docker.sock:ro",
    ]);
    expect(parsed.services.traefik.networks).toEqual(["alt"]);
    expect(parsed.networks.alt).toEqual({ name: "alt", driver: "bridge" });
    expect(parsed.networks.devtun).toBeUndefined();
  });

  it("publishes host ports and enables the dashboard API only when opted in", () => {
    writeInfraCompose(inst("devtun"), {
      ...baseConfig,
      publishHttpPort: 80,
      dashboardPort: 8080,
    });
    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.yml"), "utf-8")
    );
    expect(parsed.services.traefik.ports).toEqual([
      "80:80",
      "127.0.0.1:8080:8080",
    ]);
    expect(parsed.services.traefik.command).toContain("--api.insecure=true");
  });
});

describe("compose: checkComposeSocketDrift", () => {
  let dir: ReturnType<typeof makeTempDir>;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => dir.cleanup());

  const baseConfig = {
    domain: "example.com",
    devSubdomain: "dev.example.com",
    tunnelName: "dev-example-com",
  };
  const devtunInst = { name: "devtun", dir: "", isDefault: true };

  it("returns null when no compose file exists", () => {
    expect(
      checkComposeSocketDrift({ ...devtunInst, dir: dir.path }, baseConfig)
    ).toBeNull();
  });

  it("returns null when the compose socket matches config", () => {
    const inst = { ...devtunInst, dir: dir.path };
    writeInfraCompose(inst, baseConfig);
    expect(checkComposeSocketDrift(inst, baseConfig)).toBeNull();
  });

  it("detects a hand-edited socket mount", () => {
    const inst = { ...devtunInst, dir: dir.path };
    writeInfraCompose(inst, baseConfig);
    const composePath = join(dir.path, "docker-compose.yml");
    const edited = readFileSync(composePath, "utf-8").replace(
      "/var/run/docker.sock:/var/run/docker.sock:ro",
      "/var/run/docker-lightsout.sock:/var/run/docker.sock:ro"
    );
    writeFileSync(composePath, edited);
    expect(checkComposeSocketDrift(inst, baseConfig)).toBe(
      "/var/run/docker-lightsout.sock"
    );
  });

  it("returns null once config matches the edited socket", () => {
    const inst = { ...devtunInst, dir: dir.path };
    writeInfraCompose(inst, {
      ...baseConfig,
      dockerSocket: "/var/run/docker-lightsout.sock",
    });
    expect(
      checkComposeSocketDrift(inst, {
        ...baseConfig,
        dockerSocket: "/var/run/docker-lightsout.sock",
      })
    ).toBeNull();
  });
});

describe("compose: override files with a named instance network", () => {
  let dir: ReturnType<typeof makeTempDir>;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => dir.cleanup());

  it("round-trips add/remove with a non-default network name", () => {
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.other.com",
      routerName: "myapp",
      port: 3000,
      networkName: "alt",
    });

    const parsed = parseYaml(
      readFileSync(join(dir.path, "docker-compose.override.yml"), "utf-8")
    );
    expect(parsed.services.web.networks).toContain("alt");
    expect(parsed.networks.alt).toEqual({ external: true });
    expect(parsed.networks.devtun).toBeUndefined();

    removeOverrideLabels(dir.path, "myapp", "alt");
    expect(existsSync(join(dir.path, "docker-compose.override.yml"))).toBe(false);
  });

  it("cleans up a legacy devtun-network file even when removed via another instance", () => {
    addOverrideLabels({
      projectDir: dir.path,
      serviceName: "web",
      hostname: "myapp.dev.example.com",
      routerName: "myapp",
      port: 3000,
      networkName: "devtun",
    });

    // Wrong -i passed on remove: the service keeps its network entry, but the
    // unreferenced-external-network sweep still runs against the whole file.
    removeOverrideLabels(dir.path, "myapp", "alt");

    const overridePath = join(dir.path, "docker-compose.override.yml");
    if (existsSync(overridePath)) {
      const parsed = parseYaml(readFileSync(overridePath, "utf-8"));
      // No traefik labels must remain either way.
      const labels = parsed.services?.web?.labels ?? {};
      expect(
        Object.keys(labels).filter((k) => k.startsWith("traefik."))
      ).toEqual([]);
    }
  });
});
