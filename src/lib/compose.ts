import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { dockerSocketOf } from "./config.js";
import type { InstanceContext } from "./instance.js";
import type { DevtunnelConfig } from "./types.js";
import { parseDocument, Document, YAMLMap, isSeq, isScalar } from "yaml";

// --- Infra compose generation ---

export function writeInfraCompose(
  inst: InstanceContext,
  config: DevtunnelConfig
): void {
  const net = inst.name;
  const socket = dockerSocketOf(config);

  const traefikCommand = [
    ...(config.dashboardPort ? ['"--api.insecure=true"'] : []),
    '"--providers.docker=true"',
    '"--providers.docker.exposedbydefault=false"',
    `"--providers.docker.network=${net}"`,
    '"--entrypoints.web.address=:80"',
  ];

  const ports: string[] = [];
  if (config.publishHttpPort) {
    ports.push(`"${config.publishHttpPort}:80"`);
  }
  if (config.dashboardPort) {
    ports.push(`"127.0.0.1:${config.dashboardPort}:8080"`);
  }
  const portsBlock = ports.length
    ? `    ports:\n${ports.map((p) => `      - ${p}`).join("\n")}\n`
    : "";

  const content = `name: ${inst.name}

services:
  traefik:
    image: traefik:v3
    container_name: ${inst.name}-traefik
    command:
${traefikCommand.map((c) => `      - ${c}`).join("\n")}
${portsBlock}    volumes:
      - ${socket}:/var/run/docker.sock:ro
    networks:
      - ${net}
    restart: unless-stopped

  tunnel:
    image: cloudflare/cloudflared:latest
    container_name: ${inst.name}-tunnel
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=\${TUNNEL_TOKEN}
    networks:
      - ${net}
    restart: unless-stopped
    depends_on:
      - traefik

networks:
  ${net}:
    name: ${net}
    driver: bridge
`;
  mkdirSync(inst.dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(inst.dir, "docker-compose.yml"), content);
}

/**
 * Detect a hand-edited docker socket in the existing compose file. Returns
 * the on-disk host socket path when it disagrees with config, else null.
 * Callers refuse to regenerate while this returns non-null, so a manual
 * edit is never silently clobbered.
 */
export function checkComposeSocketDrift(
  inst: InstanceContext,
  config: DevtunnelConfig
): string | null {
  const composePath = join(inst.dir, "docker-compose.yml");
  if (!existsSync(composePath)) return null;

  let doc: Document;
  try {
    doc = parseDocument(readFileSync(composePath, "utf-8"));
  } catch {
    return null;
  }
  const volumes = doc.getIn(["services", "traefik", "volumes"]);
  if (!isSeq(volumes)) return null;

  for (const item of volumes.items) {
    if (!isScalar(item)) continue;
    const parts = String(item.value).split(":");
    // "<host-socket>:/var/run/docker.sock[:ro]"
    if (parts.length >= 2 && parts[1] === "/var/run/docker.sock") {
      const onDisk = parts[0];
      return onDisk === dockerSocketOf(config) ? null : onDisk;
    }
  }
  return null;
}

// --- Per-project override merging ---

const DEVTUNNEL_COMMENT = " devtun-managed";

export interface OverrideMapping {
  routerName: string;
  serviceName: string;
  port: number;
}

export function readOverrideMappings(projectDir: string): OverrideMapping[] {
  const overridePath = join(projectDir, "docker-compose.override.yml");
  if (!existsSync(overridePath)) return [];

  const content = readFileSync(overridePath, "utf-8");
  const doc = parseDocument(content);
  const services = doc.get("services") as YAMLMap | undefined;
  if (!services) return [];

  const mappings: OverrideMapping[] = [];

  for (const item of services.items) {
    const serviceName = String(item.key);
    const service = services.get(serviceName) as YAMLMap | undefined;
    if (!service) continue;

    const labels = service.get("labels") as YAMLMap | undefined;
    if (!(labels instanceof YAMLMap)) continue;

    // Extract router names and ports from traefik labels
    const routers = new Map<string, number>();
    for (const l of labels.items) {
      const key = String(l.key);
      const portMatch = key.match(
        /^traefik\.http\.services\.(.+?)\.loadbalancer\.server\.port$/
      );
      if (portMatch) {
        routers.set(portMatch[1], parseInt(String(l.value), 10));
      }
    }

    for (const [routerName, port] of routers) {
      mappings.push({ routerName, serviceName, port });
    }
  }

  return mappings;
}

export type CacheMode = "none" | "cdn" | "all";

export const CACHE_MODES: readonly CacheMode[] = ["none", "cdn", "all"] as const;

export const DEFAULT_CACHE_MODE: CacheMode = "all";

interface OverrideOptions {
  projectDir: string;
  serviceName: string;
  hostname: string;
  routerName: string;
  port: number;
  cache?: CacheMode;
  /** Instance network the service joins (the devtun instance name). */
  networkName: string;
}

export function addOverrideLabels(opts: OverrideOptions): void {
  const overridePath = join(opts.projectDir, "docker-compose.override.yml");

  let doc: Document;
  if (existsSync(overridePath)) {
    const content = readFileSync(overridePath, "utf-8");
    doc = parseDocument(content);
  } else {
    doc = new Document({});
  }

  // Ensure services map exists
  if (!doc.has("services")) {
    doc.set("services", doc.createNode({}));
  }
  const services = doc.get("services", true) as YAMLMap;

  // Ensure service exists
  if (!services.has(opts.serviceName)) {
    services.set(doc.createNode(opts.serviceName), doc.createNode({}));
  }
  const service = services.get(opts.serviceName, true) as unknown as YAMLMap;

  // Set labels as a mapping (not array)
  const labels: Record<string, string> = {};

  // Preserve existing non-devtun labels
  const existingLabels = service.get("labels");
  if (existingLabels instanceof YAMLMap) {
    for (const item of existingLabels.items) {
      const key = String(item.key);
      if (!key.startsWith("traefik.")) {
        labels[key] = String(item.value);
      }
    }
  }

  // Add devtun labels
  labels["traefik.enable"] = "true";
  labels[`traefik.http.routers.${opts.routerName}.rule`] =
    `Host(\`${opts.hostname}\`)`;
  labels[`traefik.http.routers.${opts.routerName}.entrypoints`] = "web";
  labels[`traefik.http.services.${opts.routerName}.loadbalancer.server.port`] =
    String(opts.port);

  const cache = opts.cache ?? DEFAULT_CACHE_MODE;
  if (cache !== "none") {
    labels[
      `traefik.http.middlewares.${opts.routerName}-nocache.headers.customresponseheaders.CDN-Cache-Control`
    ] = "no-store";
    if (cache === "all") {
      labels[
        `traefik.http.middlewares.${opts.routerName}-nocache.headers.customresponseheaders.Cache-Control`
      ] = "no-store, no-cache, must-revalidate, max-age=0";
    }
    labels[`traefik.http.routers.${opts.routerName}.middlewares`] =
      `${opts.routerName}-nocache`;
  }

  const labelsNode = doc.createNode(labels);
  labelsNode.commentBefore = DEVTUNNEL_COMMENT;
  service.set("labels", labelsNode);

  // Ensure service has the instance network
  const net = opts.networkName;
  const serviceNetworks = service.get("networks");
  if (!serviceNetworks) {
    service.set("networks", ["default", net]);
  } else if (Array.isArray(service.toJSON().networks)) {
    const nets: string[] = service.toJSON().networks;
    if (!nets.includes(net)) {
      nets.push(net);
      service.set("networks", nets);
    }
  }

  // Ensure top-level networks has <network>: external: true
  const networks = doc.get("networks") as YAMLMap | undefined;
  if (!networks) {
    doc.set("networks", { [net]: { external: true } });
  } else if (!networks.get(net)) {
    networks.set(net, { external: true });
  }

  writeFileSync(overridePath, doc.toString());
}

export function removeOverrideLabels(
  projectDir: string,
  routerName: string,
  networkName: string
): void {
  const overridePath = join(projectDir, "docker-compose.override.yml");
  if (!existsSync(overridePath)) return;

  const content = readFileSync(overridePath, "utf-8");
  const doc = parseDocument(content);

  const services = doc.get("services") as YAMLMap | undefined;
  if (!services) return;

  // Find the service that has labels for this router name
  for (const item of services.items) {
    const serviceName = String(item.key);
    const service = services.get(serviceName) as YAMLMap | undefined;
    if (!service) continue;

    const labels = service.get("labels") as YAMLMap | undefined;
    if (!(labels instanceof YAMLMap)) continue;

    // Check if this service has labels for the target router
    const hasRouter = labels.items.some((l) => {
      const key = String(l.key);
      return (
        key.includes(`.routers.${routerName}.`) ||
        key.includes(`.services.${routerName}.`) ||
        key.includes(`.middlewares.${routerName}`)
      );
    });
    if (!hasRouter) continue;

    // Remove labels for this router
    const toRemove: string[] = [];
    for (const l of labels.items) {
      const key = String(l.key);
      if (
        key.includes(`.routers.${routerName}.`) ||
        key.includes(`.services.${routerName}.`) ||
        key.includes(`.middlewares.${routerName}`)
      ) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      labels.delete(key);
    }

    // If no traefik labels OTHER than traefik.enable remain, remove enable too
    const remainingTraefik = labels.items.some((l) => {
      const key = String(l.key);
      return key.startsWith("traefik.") && key !== "traefik.enable";
    });
    if (!remainingTraefik) {
      labels.delete("traefik.enable");
    }

    if (labels.items.length === 0) {
      service.delete("labels");
    }

    // Remove the instance network only if no traefik labels remain on this service
    if (!remainingTraefik) {
      const serviceJson = service.toJSON();
      if (Array.isArray(serviceJson?.networks)) {
        const nets = serviceJson.networks.filter(
          (n: string) => n !== networkName
        );
        if (nets.length === 0) {
          service.delete("networks");
        } else {
          service.set("networks", nets);
        }
      }
    }

    // If the only thing left on the service is the "default" network entry
    // that addOverrideLabels adds when creating a fresh service, that's ours
    // too - drop it so the service entry can be removed cleanly.
    if (service instanceof YAMLMap && service.items.length === 1) {
      const onlyItem = service.items[0];
      if (String(onlyItem.key) === "networks") {
        const json = service.toJSON();
        const nets = json?.networks;
        if (Array.isArray(nets) && nets.length === 1 && nets[0] === "default") {
          service.delete("networks");
        }
      }
    }

    // Remove service if empty
    if (service instanceof YAMLMap && service.items.length === 0) {
      services.delete(serviceName);
    }
  }

  // Drop top-level external networks (devtun-managed) no longer referenced
  // by any service. Sweeping all of them - not just networkName - cleans up
  // correctly even when the file was written against a different instance.
  const networks = doc.get("networks") as YAMLMap | undefined;
  if (networks) {
    const referenced = new Set<string>();
    for (const item of services.items) {
      const service = services.get(String(item.key)) as YAMLMap | undefined;
      const nets = service?.toJSON()?.networks;
      if (Array.isArray(nets)) {
        for (const n of nets) referenced.add(String(n));
      }
    }
    const toDelete: string[] = [];
    for (const item of networks.items) {
      const netName = String(item.key);
      const netDef = networks.get(netName) as unknown;
      const json =
        netDef instanceof YAMLMap ? (netDef.toJSON() as Record<string, unknown>) : netDef;
      const isExternalOnly =
        json !== null &&
        typeof json === "object" &&
        Object.keys(json).length === 1 &&
        (json as Record<string, unknown>)["external"] === true;
      if (isExternalOnly && !referenced.has(netName)) {
        toDelete.push(netName);
      }
    }
    for (const netName of toDelete) {
      networks.delete(netName);
    }
    if (networks.items.length === 0) {
      doc.delete("networks");
    }
  }

  // Remove services if empty
  if (services instanceof YAMLMap && services.items.length === 0) {
    doc.delete("services");
  }

  // Delete file if document is effectively empty
  const result = doc.toJSON();
  if (!result || Object.keys(result).length === 0) {
    unlinkSync(overridePath);
  } else {
    writeFileSync(overridePath, doc.toString());
  }
}

