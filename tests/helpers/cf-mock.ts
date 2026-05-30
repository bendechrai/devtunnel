import { http, HttpResponse, type HttpHandler } from "msw";
import { setupServer, type SetupServerApi } from "msw/node";
import { randomUUID } from "crypto";

const CF_API = "https://api.cloudflare.com/client/v4";

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

interface Tunnel {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface CustomHostname {
  id: string;
  hostname: string;
  status: string;
  created_at: string;
  ssl: {
    id?: string;
    status: string;
    method: string;
    type: string;
  };
  ownership_verification?: {
    type: string;
    name: string;
    value: string;
  };
}

interface Zone {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  dnsRecords: Map<string, DnsRecord>;
  customHostnames: Map<string, CustomHostname>;
  sslMode: string;
  universalSslEnabled: boolean;
  saasEnabled: boolean;
  fallbackOrigin: { origin: string; status: string } | null;
}

interface Account {
  id: string;
  tunnels: Map<string, Tunnel>;
  tunnelConfigs: Map<string, unknown>;
}

interface MockState {
  zones: Map<string, Zone>;
  zonesByName: Map<string, Zone>;
  accounts: Map<string, Account>;
  authToken: string | null;
  rejectAuth: boolean;
}

export function createState(): MockState {
  return {
    zones: new Map(),
    zonesByName: new Map(),
    accounts: new Map(),
    authToken: "test-token",
    rejectAuth: false,
  };
}

export function addZone(
  state: MockState,
  domain: string,
  options: { accountId?: string; saasEnabled?: boolean } = {}
): Zone {
  const accountId = options.accountId ?? "acc-" + randomUUID().slice(0, 8);
  const zone: Zone = {
    id: "zone-" + randomUUID().slice(0, 8),
    name: domain,
    accountId,
    accountName: "Test Account",
    dnsRecords: new Map(),
    customHostnames: new Map(),
    sslMode: "flexible",
    universalSslEnabled: false,
    saasEnabled: options.saasEnabled ?? true,
    fallbackOrigin: null,
  };
  state.zones.set(zone.id, zone);
  state.zonesByName.set(domain, zone);

  if (!state.accounts.has(accountId)) {
    state.accounts.set(accountId, {
      id: accountId,
      tunnels: new Map(),
      tunnelConfigs: new Map(),
    });
  }

  return zone;
}

function ok<T>(result: T, extra: Record<string, unknown> = {}): HttpResponse {
  return HttpResponse.json({
    success: true,
    errors: [],
    messages: [],
    result,
    ...extra,
  });
}

function err(code: number, message: string, status = 400): HttpResponse {
  return HttpResponse.json(
    {
      success: false,
      errors: [{ code, message }],
      messages: [],
      result: null,
    },
    { status }
  );
}

function authOk(req: Request, state: MockState): boolean {
  if (state.rejectAuth) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/, "");
  return token === state.authToken;
}

export function buildHandlers(state: MockState): HttpHandler[] {
  return [
    // Zone lookup
    http.get(`${CF_API}/zones`, ({ request }) => {
      if (!authOk(request, state)) return err(9109, "Invalid access token", 403);
      const url = new URL(request.url);
      const name = url.searchParams.get("name");
      if (!name) return ok([]);
      const zone = state.zonesByName.get(name);
      if (!zone) return ok([]);
      return ok([
        {
          id: zone.id,
          name: zone.name,
          account: { id: zone.accountId, name: zone.accountName },
        },
      ]);
    }),

    // DNS records: list/find
    http.get(`${CF_API}/zones/:zoneId/dns_records`, ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const zone = state.zones.get(params["zoneId"] as string);
      if (!zone) return err(7003, "Zone not found", 404);
      const url = new URL(request.url);
      const name = url.searchParams.get("name");
      const type = url.searchParams.get("type");
      let records = [...zone.dnsRecords.values()];
      if (name) records = records.filter((r) => r.name === name);
      if (type) records = records.filter((r) => r.type === type);
      return ok(records);
    }),

    // DNS record: create
    http.post(`${CF_API}/zones/:zoneId/dns_records`, async ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const zone = state.zones.get(params["zoneId"] as string);
      if (!zone) return err(7003, "Zone not found", 404);
      const body = (await request.json()) as Omit<DnsRecord, "id">;
      const id = "dns-" + randomUUID().slice(0, 8);
      const record: DnsRecord = {
        id,
        type: body.type,
        name: body.name,
        content: body.content,
        proxied: body.proxied,
        ttl: body.ttl ?? 1,
      };
      zone.dnsRecords.set(id, record);
      return ok(record);
    }),

    // DNS record: update
    http.patch(
      `${CF_API}/zones/:zoneId/dns_records/:recordId`,
      async ({ request, params }) => {
        if (!authOk(request, state)) return err(9109, "Invalid token", 403);
        const zone = state.zones.get(params["zoneId"] as string);
        if (!zone) return err(7003, "Zone not found", 404);
        const record = zone.dnsRecords.get(params["recordId"] as string);
        if (!record) return err(81044, "Record not found", 404);
        const body = (await request.json()) as Partial<DnsRecord>;
        Object.assign(record, body);
        return ok(record);
      }
    ),

    // DNS record: delete
    http.delete(`${CF_API}/zones/:zoneId/dns_records/:recordId`, ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const zone = state.zones.get(params["zoneId"] as string);
      if (!zone) return err(7003, "Zone not found", 404);
      zone.dnsRecords.delete(params["recordId"] as string);
      return ok({ id: params["recordId"] });
    }),

    // Tunnels: find
    http.get(`${CF_API}/accounts/:accountId/cfd_tunnel`, ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const account = state.accounts.get(params["accountId"] as string);
      if (!account) return err(1001, "Account not found", 404);
      const url = new URL(request.url);
      const name = url.searchParams.get("name");
      let tunnels = [...account.tunnels.values()];
      if (name) tunnels = tunnels.filter((t) => t.name === name);
      return ok(tunnels);
    }),

    // Tunnel: create
    http.post(`${CF_API}/accounts/:accountId/cfd_tunnel`, async ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const account = state.accounts.get(params["accountId"] as string);
      if (!account) return err(1001, "Account not found", 404);
      const body = (await request.json()) as { name: string };
      const tunnel: Tunnel = {
        id: "tunnel-" + randomUUID().slice(0, 8),
        name: body.name,
        status: "healthy",
        created_at: new Date().toISOString(),
      };
      account.tunnels.set(tunnel.id, tunnel);
      return ok(tunnel);
    }),

    // Tunnel: delete
    http.delete(`${CF_API}/accounts/:accountId/cfd_tunnel/:tunnelId`, ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const account = state.accounts.get(params["accountId"] as string);
      if (!account) return err(1001, "Account not found", 404);
      account.tunnels.delete(params["tunnelId"] as string);
      return ok({ id: params["tunnelId"] });
    }),

    // Tunnel: token
    http.get(
      `${CF_API}/accounts/:accountId/cfd_tunnel/:tunnelId/token`,
      ({ request, params }) => {
        if (!authOk(request, state)) return err(9109, "Invalid token", 403);
        const account = state.accounts.get(params["accountId"] as string);
        if (!account) return err(1001, "Account not found", 404);
        const tunnel = account.tunnels.get(params["tunnelId"] as string);
        if (!tunnel) return err(1001, "Tunnel not found", 404);
        return ok(`tunnel-token-${tunnel.id}`);
      }
    ),

    // Tunnel: configuration
    http.put(
      `${CF_API}/accounts/:accountId/cfd_tunnel/:tunnelId/configurations`,
      async ({ request, params }) => {
        if (!authOk(request, state)) return err(9109, "Invalid token", 403);
        const account = state.accounts.get(params["accountId"] as string);
        if (!account) return err(1001, "Account not found", 404);
        const body = await request.json();
        account.tunnelConfigs.set(params["tunnelId"] as string, body);
        return ok({ config: body });
      }
    ),

    // SSL: get/set mode
    http.get(`${CF_API}/zones/:zoneId/settings/ssl`, ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const zone = state.zones.get(params["zoneId"] as string);
      if (!zone) return err(7003, "Zone not found", 404);
      return ok({ value: zone.sslMode });
    }),
    http.patch(`${CF_API}/zones/:zoneId/settings/ssl`, async ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const zone = state.zones.get(params["zoneId"] as string);
      if (!zone) return err(7003, "Zone not found", 404);
      const body = (await request.json()) as { value: string };
      zone.sslMode = body.value;
      return ok({ value: zone.sslMode });
    }),

    // Universal SSL
    http.get(`${CF_API}/zones/:zoneId/ssl/universal/settings`, ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const zone = state.zones.get(params["zoneId"] as string);
      if (!zone) return err(7003, "Zone not found", 404);
      return ok({ enabled: zone.universalSslEnabled });
    }),
    http.patch(
      `${CF_API}/zones/:zoneId/ssl/universal/settings`,
      async ({ request, params }) => {
        if (!authOk(request, state)) return err(9109, "Invalid token", 403);
        const zone = state.zones.get(params["zoneId"] as string);
        if (!zone) return err(7003, "Zone not found", 404);
        const body = (await request.json()) as { enabled: boolean };
        zone.universalSslEnabled = body.enabled;
        return ok({ enabled: zone.universalSslEnabled });
      }
    ),

    // Custom hostnames: list/find
    http.get(`${CF_API}/zones/:zoneId/custom_hostnames`, ({ request, params }) => {
      if (!authOk(request, state)) return err(9109, "Invalid token", 403);
      const zone = state.zones.get(params["zoneId"] as string);
      if (!zone) return err(7003, "Zone not found", 404);
      if (!zone.saasEnabled) return err(1429, "SaaS not enabled", 400);

      const url = new URL(request.url);
      const hostname = url.searchParams.get("hostname");
      const all = [...zone.customHostnames.values()];
      const filtered = hostname ? all.filter((h) => h.hostname === hostname) : all;

      return ok(filtered, {
        result_info: {
          page: 1,
          per_page: 50,
          count: filtered.length,
          total_count: filtered.length,
          total_pages: 1,
        },
      });
    }),

    // Custom hostname: create
    http.post(
      `${CF_API}/zones/:zoneId/custom_hostnames`,
      async ({ request, params }) => {
        if (!authOk(request, state)) return err(9109, "Invalid token", 403);
        const zone = state.zones.get(params["zoneId"] as string);
        if (!zone) return err(7003, "Zone not found", 404);
        if (!zone.saasEnabled) return err(1429, "SaaS not enabled", 400);

        const body = (await request.json()) as {
          hostname: string;
          ssl?: { method?: string; type?: string };
        };
        const ch: CustomHostname = {
          id: "ch-" + randomUUID().slice(0, 8),
          hostname: body.hostname,
          status: "pending",
          created_at: new Date().toISOString(),
          ssl: {
            status: "pending_validation",
            method: body.ssl?.method ?? "http",
            type: body.ssl?.type ?? "dv",
          },
        };
        zone.customHostnames.set(ch.id, ch);
        return ok(ch);
      }
    ),

    // Custom hostname: delete
    http.delete(
      `${CF_API}/zones/:zoneId/custom_hostnames/:chId`,
      ({ request, params }) => {
        if (!authOk(request, state)) return err(9109, "Invalid token", 403);
        const zone = state.zones.get(params["zoneId"] as string);
        if (!zone) return err(7003, "Zone not found", 404);
        zone.customHostnames.delete(params["chId"] as string);
        return ok({ id: params["chId"] });
      }
    ),

    // Fallback origin: get/set
    http.get(
      `${CF_API}/zones/:zoneId/custom_hostnames/fallback_origin`,
      ({ request, params }) => {
        if (!authOk(request, state)) return err(9109, "Invalid token", 403);
        const zone = state.zones.get(params["zoneId"] as string);
        if (!zone) return err(7003, "Zone not found", 404);
        if (!zone.fallbackOrigin) return err(1551, "No fallback set", 404);
        return ok(zone.fallbackOrigin);
      }
    ),
    http.put(
      `${CF_API}/zones/:zoneId/custom_hostnames/fallback_origin`,
      async ({ request, params }) => {
        if (!authOk(request, state)) return err(9109, "Invalid token", 403);
        const zone = state.zones.get(params["zoneId"] as string);
        if (!zone) return err(7003, "Zone not found", 404);
        const body = (await request.json()) as { origin: string };
        zone.fallbackOrigin = { origin: body.origin, status: "active" };
        return ok(zone.fallbackOrigin);
      }
    ),
  ];
}

export interface MockServer {
  state: MockState;
  server: SetupServerApi;
}

export function startMockCloudflare(): MockServer {
  const state = createState();
  const server = setupServer(...buildHandlers(state));
  server.listen({ onUnhandledRequest: "error" });
  return { state, server };
}
