import type {
  CloudflareResponse,
  CfZone,
  CfDnsRecord,
  CfTunnel,
  CfCustomHostname,
  CfFallbackOrigin,
  CfSslSetting,
  CfUniversalSsl,
  CfTunnelConfig,
} from "./types.js";

const CF_API = "https://api.cloudflare.com/client/v4";

let token: string;

export function setToken(t: string): void {
  token = t;
}

async function cfFetch<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<CloudflareResponse<T>> {
  if (!token) throw new Error("Cloudflare API token not set");

  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: CloudflareResponse<T>;
  try {
    json = JSON.parse(text) as CloudflareResponse<T>;
  } catch {
    throw new Error(
      `Cloudflare API [${method} ${path}]: unexpected response (HTTP ${res.status}): ${text.slice(0, 200)}`
    );
  }

  if (!json.success) {
    const msgs = json.errors
      .map((e) => `${e.message} (code: ${e.code})`)
      .join(", ");
    throw new Error(`Cloudflare API [${method} ${path}]: ${msgs}`);
  }

  return json;
}

// --- Zone ---

export async function getZone(
  domain: string
): Promise<{ zoneId: string; accountId: string }> {
  const res = await cfFetch<CfZone[]>("GET", `/zones?name=${encodeURIComponent(domain)}`);
  const zone = res.result[0];
  if (!zone) throw new Error(`Zone not found for ${domain}`);
  return { zoneId: zone.id, accountId: zone.account.id };
}

// --- DNS ---

export async function findDnsRecord(
  zoneId: string,
  name: string,
  type?: string
): Promise<CfDnsRecord | null> {
  const typeParam = type ? `&type=${encodeURIComponent(type)}` : "";
  const res = await cfFetch<CfDnsRecord[]>(
    "GET",
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}${typeParam}`
  );
  return res.result[0] ?? null;
}

export async function createDnsRecord(
  zoneId: string,
  record: {
    type: string;
    name: string;
    content: string;
    proxied: boolean;
    ttl?: number;
  }
): Promise<CfDnsRecord> {
  const res = await cfFetch<CfDnsRecord>(
    "POST",
    `/zones/${zoneId}/dns_records`,
    { ttl: 1, ...record }
  );
  return res.result;
}

export async function updateDnsRecord(
  zoneId: string,
  recordId: string,
  record: {
    type: string;
    name: string;
    content: string;
    proxied: boolean;
    ttl?: number;
  }
): Promise<CfDnsRecord> {
  const res = await cfFetch<CfDnsRecord>(
    "PATCH",
    `/zones/${zoneId}/dns_records/${recordId}`,
    { ttl: 1, ...record }
  );
  return res.result;
}

export async function deleteDnsRecord(
  zoneId: string,
  recordId: string
): Promise<void> {
  await cfFetch<unknown>("DELETE", `/zones/${zoneId}/dns_records/${recordId}`);
}

// --- Tunnels ---

export async function findTunnel(
  accountId: string,
  name: string
): Promise<CfTunnel | null> {
  const res = await cfFetch<CfTunnel[]>(
    "GET",
    `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`
  );
  return res.result[0] ?? null;
}

export async function createTunnel(
  accountId: string,
  name: string
): Promise<CfTunnel> {
  const res = await cfFetch<CfTunnel>(
    "POST",
    `/accounts/${accountId}/cfd_tunnel`,
    { name, config_src: "cloudflare", tunnel_secret: generateTunnelSecret() }
  );
  return res.result;
}

export async function deleteTunnel(
  accountId: string,
  tunnelId: string
): Promise<void> {
  await cfFetch<unknown>(
    "DELETE",
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}`
  );
}

export async function getTunnelToken(
  accountId: string,
  tunnelId: string
): Promise<string> {
  const res = await cfFetch<string>(
    "GET",
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`
  );
  return res.result;
}

export async function configureTunnel(
  accountId: string,
  tunnelId: string,
  devSubdomain: string
): Promise<void> {
  await cfFetch<CfTunnelConfig>(
    "PUT",
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    {
      config: {
        ingress: [
          { hostname: `*.${devSubdomain}`, service: "http://devtun-traefik:80" },
          { service: "http_status:404" },
        ],
      },
    }
  );
}

function generateTunnelSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// --- SSL ---

export async function getSslMode(zoneId: string): Promise<string> {
  const res = await cfFetch<CfSslSetting>(
    "GET",
    `/zones/${zoneId}/settings/ssl`
  );
  return res.result.value;
}

export async function setSslMode(
  zoneId: string,
  value: string
): Promise<void> {
  await cfFetch<CfSslSetting>("PATCH", `/zones/${zoneId}/settings/ssl`, {
    value,
  });
}

export async function getUniversalSsl(zoneId: string): Promise<boolean> {
  const res = await cfFetch<CfUniversalSsl>(
    "GET",
    `/zones/${zoneId}/ssl/universal/settings`
  );
  return res.result.enabled;
}

export async function setUniversalSsl(
  zoneId: string,
  enabled: boolean
): Promise<void> {
  await cfFetch<CfUniversalSsl>(
    "PATCH",
    `/zones/${zoneId}/ssl/universal/settings`,
    { enabled }
  );
}

// --- Custom Hostnames (SaaS) ---

export async function isSaasEnabled(zoneId: string): Promise<boolean> {
  try {
    await cfFetch<CfCustomHostname[]>(
      "GET",
      `/zones/${zoneId}/custom_hostnames`
    );
    return true;
  } catch {
    return false;
  }
}

export async function listCustomHostnames(
  zoneId: string
): Promise<CfCustomHostname[]> {
  const all: CfCustomHostname[] = [];
  let page = 1;
  while (true) {
    const res = await cfFetch<CfCustomHostname[]>(
      "GET",
      `/zones/${zoneId}/custom_hostnames?per_page=50&page=${page}`
    );
    all.push(...res.result);
    if (!res.result_info || all.length >= res.result_info.total_count) break;
    page++;
  }
  return all;
}

export async function findCustomHostname(
  zoneId: string,
  hostname: string
): Promise<CfCustomHostname | null> {
  const res = await cfFetch<CfCustomHostname[]>(
    "GET",
    `/zones/${zoneId}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`
  );
  return res.result[0] ?? null;
}

export async function createCustomHostname(
  zoneId: string,
  hostname: string
): Promise<CfCustomHostname> {
  const res = await cfFetch<CfCustomHostname>(
    "POST",
    `/zones/${zoneId}/custom_hostnames`,
    {
      hostname,
      ssl: { method: "http", type: "dv", wildcard: false },
    }
  );
  return res.result;
}

export async function deleteCustomHostname(
  zoneId: string,
  hostnameId: string
): Promise<void> {
  await cfFetch<unknown>(
    "DELETE",
    `/zones/${zoneId}/custom_hostnames/${hostnameId}`
  );
}

// --- Fallback Origin ---

export async function getFallbackOrigin(
  zoneId: string
): Promise<CfFallbackOrigin | null> {
  try {
    const res = await cfFetch<CfFallbackOrigin>(
      "GET",
      `/zones/${zoneId}/custom_hostnames/fallback_origin`
    );
    return res.result;
  } catch {
    return null;
  }
}

export async function setFallbackOrigin(
  zoneId: string,
  origin: string
): Promise<CfFallbackOrigin> {
  const res = await cfFetch<CfFallbackOrigin>(
    "PUT",
    `/zones/${zoneId}/custom_hostnames/fallback_origin`,
    { origin }
  );
  return res.result;
}
