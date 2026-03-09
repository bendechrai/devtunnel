import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { configDir } from "./config.js";
import { parseDocument, Document, YAMLMap } from "yaml";

// --- Infra compose generation ---

export function writeInfraCompose(): void {
  const content = `services:
  traefik:
    image: traefik:v3.2
    container_name: devtun-traefik
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=devtun"
      - "--entrypoints.web.address=:80"
    ports:
      - "80:80"
      - "127.0.0.1:8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - devtun
    restart: unless-stopped

  tunnel:
    image: cloudflare/cloudflared:latest
    container_name: devtun-tunnel
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=\${TUNNEL_TOKEN}
    networks:
      - devtun
    restart: unless-stopped
    depends_on:
      - traefik

networks:
  devtun:
    name: devtun
    driver: bridge
`;
  writeFileSync(join(configDir(), "docker-compose.yml"), content);
}

// --- Per-project override merging ---

const DEVTUNNEL_COMMENT = " devtun-managed";

interface OverrideOptions {
  projectDir: string;
  serviceName: string;
  hostname: string;
  routerName: string;
  port: number;
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

  const labelsNode = doc.createNode(labels);
  labelsNode.commentBefore = DEVTUNNEL_COMMENT;
  service.set("labels", labelsNode);

  // Ensure service has devtun network
  let serviceNetworks = service.get("networks");
  if (!serviceNetworks) {
    service.set("networks", ["default", "devtun"]);
  } else if (Array.isArray(service.toJSON().networks)) {
    const nets: string[] = service.toJSON().networks;
    if (!nets.includes("devtun")) {
      nets.push("devtun");
      service.set("networks", nets);
    }
  }

  // Ensure top-level networks has devtun: external: true
  let networks = doc.get("networks") as YAMLMap | undefined;
  if (!networks) {
    doc.set("networks", { devtun: { external: true } });
  } else if (!networks.get("devtun")) {
    networks.set("devtun", { external: true });
  }

  writeFileSync(overridePath, doc.toString());
}

export function removeOverrideLabels(projectDir: string): void {
  const overridePath = join(projectDir, "docker-compose.override.yml");
  if (!existsSync(overridePath)) return;

  const content = readFileSync(overridePath, "utf-8");
  const doc = parseDocument(content);

  const services = doc.get("services") as YAMLMap | undefined;
  if (!services) return;

  // Find all services that have traefik labels (devtun-managed)
  for (const item of services.items) {
    const serviceName = String(item.key);
    const service = services.get(serviceName) as YAMLMap | undefined;
    if (!service) continue;

    const labels = service.get("labels") as YAMLMap | undefined;
    if (!(labels instanceof YAMLMap)) continue;

    const hasTraefik = labels.items.some((l) =>
      String(l.key).startsWith("traefik.")
    );
    if (!hasTraefik) continue;

    // Remove traefik labels
    const toRemove: string[] = [];
    for (const l of labels.items) {
      const key = String(l.key);
      if (key.startsWith("traefik.")) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      labels.delete(key);
    }
    if (labels.items.length === 0) {
      service.delete("labels");
    }

    // Remove devtun from service networks
    const serviceJson = service.toJSON();
    if (Array.isArray(serviceJson?.networks)) {
      const nets = serviceJson.networks.filter(
        (n: string) => n !== "devtun"
      );
      if (nets.length === 0) {
        service.delete("networks");
      } else {
        service.set("networks", nets);
      }
    }

    // Remove service if empty
    if (service instanceof YAMLMap && service.items.length === 0) {
      services.delete(serviceName);
    }
  }

  // Remove top-level devtun network if no services reference it
  const networks = doc.get("networks") as YAMLMap | undefined;
  if (networks) {
    networks.delete("devtun");
    if (networks instanceof YAMLMap && networks.items.length === 0) {
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

export function detectServiceAndPort(
  projectDir: string
): { serviceName: string; port: number } | null {
  const composePath = join(projectDir, "docker-compose.yml");
  if (!existsSync(composePath)) return null;

  const content = readFileSync(composePath, "utf-8");
  const doc = parseDocument(content);
  const services = doc.get("services") as YAMLMap | undefined;
  if (!services) return null;

  // If only one service, use it
  const serviceNames = services.items.map((item) => String(item.key));
  if (serviceNames.length === 0) return null;

  // Find the first service with a port mapping
  for (const name of serviceNames) {
    const service = services.get(name) as YAMLMap | undefined;
    if (!service) continue;

    const ports = service.toJSON()?.ports;
    if (Array.isArray(ports) && ports.length > 0) {
      const portStr = String(ports[0]);
      // Parse "3000:3000" or "8080:3000" or just "3000"
      const match = portStr.match(/:(\d+)$/) ?? portStr.match(/^(\d+)$/);
      if (match) {
        return { serviceName: name, port: parseInt(match[1], 10) };
      }
    }
  }

  // Fallback: prefer common app service names, then first service
  const preferred = ["web", "app", "server", "api"];
  const fallbackName =
    serviceNames.find((n) => preferred.includes(n)) ?? serviceNames[0];
  return { serviceName: fallbackName, port: 3000 };
}
