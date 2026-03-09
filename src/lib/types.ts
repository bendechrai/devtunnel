export interface DevtunnelConfig {
  domain: string;
  devSubdomain: string;
  tunnelName: string;
  tunnelId?: string;
  tunnelToken?: string;
  zoneId?: string;
  accountId?: string;
  cfTokenSource?: string;
}

export interface CloudflareResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
  result_info?: {
    page: number;
    per_page: number;
    count: number;
    total_count: number;
    total_pages: number;
  };
}

export interface CfZone {
  id: string;
  name: string;
  account: { id: string; name: string };
}

export interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

export interface CfTunnel {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

export interface CfCustomHostname {
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

export interface CfFallbackOrigin {
  origin: string;
  status: string;
}

export interface CfSslSetting {
  value: string;
}

export interface CfUniversalSsl {
  enabled: boolean;
}

export interface CfCertificatePack {
  id: string;
  type: string;
  hosts: string[];
  status: string;
}

export interface CfTunnelConfig {
  config: {
    ingress: Array<{
      hostname?: string;
      service: string;
    }>;
  };
}
