import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { configExists, loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import { isDockerRunning, isStackRunning } from "../lib/docker.js";
import { parseFlags } from "../lib/flags.js";
import type { DevtunnelConfig } from "../lib/types.js";

type CheckResult = "ok" | "warn" | "fail" | "skip";

interface Check {
  name: string;
  status: CheckResult;
  detail: string;
}

interface Tally {
  ok: number;
  warn: number;
  fail: number;
  skip: number;
}

function makeRecorder(): {
  checks: Check[];
  tally: Tally;
  record: (name: string, status: CheckResult, detail: string) => void;
} {
  const checks: Check[] = [];
  const tally: Tally = { ok: 0, warn: 0, fail: 0, skip: 0 };
  return {
    checks,
    tally,
    record(name, status, detail) {
      checks.push({ name, status, detail });
      tally[status] += 1;
      const label =
        status === "ok"
          ? "OK"
          : status === "warn"
            ? "WARN"
            : status === "fail"
              ? "FAIL"
              : "SKIP";
      const line = `[${label}] ${name}: ${detail}`;
      if (status === "ok") out.success(line);
      else if (status === "warn") out.warn(line);
      else if (status === "fail") out.error(line);
      else out.dim(line);
    },
  };
}

function finish(checks: Check[], tally: Tally, asJson: boolean): void {
  if (asJson) {
    out.json({
      summary: { ...tally },
      checks,
    });
  } else {
    out.blank();
    out.info(
      `${tally.ok} ok, ${tally.warn} warning(s), ${tally.fail} failure(s)${tally.skip ? `, ${tally.skip} skipped` : ""}`
    );
    out.blank();
  }
  if (tally.fail > 0) process.exit(1);
}

export async function doctor(args: string[] = []): Promise<void> {
  const { flags } = parseFlags(args, { boolean: ["json"] });
  const asJson = flags["json"] === true;
  if (asJson) out.setJsonMode(true);

  out.header("devtun doctor");

  const { checks, tally, record } = makeRecorder();

  // 1. Config file
  if (!configExists()) {
    record("config file", "fail", "~/.devtun/config.json not found. Run `devtun setup`.");
    finish(checks, tally, asJson);
    return;
  }

  let cfg: DevtunnelConfig;
  try {
    cfg = loadConfig();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record("config file", "fail", msg);
    finish(checks, tally, asJson);
    return;
  }
  record(
    "config file",
    "ok",
    `domain=${cfg.domain}, devSubdomain=${cfg.devSubdomain}`
  );

  // 2. Cloudflare token
  let token: string;
  try {
    token = resolveToken(cfg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record("cloudflare token", "fail", msg);
    skipRemainingCloudflare(record);
    await checkDocker(record);
    finish(checks, tally, asJson);
    return;
  }
  cf.setToken(token);
  record("cloudflare token", "ok", "resolved");

  // 3. Zone access
  let zoneId: string;
  let accountId: string;
  try {
    const zone = await cf.getZone(cfg.domain);
    zoneId = zone.zoneId;
    accountId = zone.accountId;

    if (cfg.zoneId && cfg.zoneId !== zoneId) {
      record(
        "zone access",
        "warn",
        `resolved ${zoneId} but config has ${cfg.zoneId}. Run \`devtun setup\` to refresh.`
      );
    } else if (cfg.accountId && cfg.accountId !== accountId) {
      record(
        "zone access",
        "warn",
        `resolved account ${accountId} but config has ${cfg.accountId}. Run \`devtun setup\` to refresh.`
      );
    } else {
      record("zone access", "ok", `zone ${zoneId} on account ${accountId}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record("zone access", "fail", msg);
    skipRemainingCloudflare(record, true);
    await checkDocker(record);
    finish(checks, tally, asJson);
    return;
  }

  // 4. Tunnel
  try {
    const tunnel = await cf.findTunnel(accountId, cfg.tunnelName);
    if (!tunnel) {
      record(
        "tunnel",
        "fail",
        `no tunnel named '${cfg.tunnelName}' on this account. Run \`devtun setup\`.`
      );
    } else if (cfg.tunnelId && cfg.tunnelId !== tunnel.id) {
      record(
        "tunnel",
        "warn",
        `found ${tunnel.id} but config has ${cfg.tunnelId}. Run \`devtun setup\` to refresh.`
      );
    } else {
      record(
        "tunnel",
        "ok",
        `'${cfg.tunnelName}' (${tunnel.id}, ${tunnel.status})`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record("tunnel", "fail", msg);
  }

  // 5. SaaS enabled
  const saasEnabled = await cf.isSaasEnabled(zoneId);
  if (saasEnabled) {
    record("cloudflare for SaaS", "ok", "enabled");
  } else {
    record(
      "cloudflare for SaaS",
      "fail",
      "not enabled. Enable it in the Cloudflare dashboard, then run `devtun setup`."
    );
  }

  // 6. Fallback origin
  const expectedFallback = `tunnel-origin.${cfg.domain}`;
  try {
    const fallback = await cf.getFallbackOrigin(zoneId);
    if (!fallback) {
      record(
        "fallback origin",
        "fail",
        `not configured. Expected ${expectedFallback}.`
      );
    } else if (fallback.origin !== expectedFallback) {
      record(
        "fallback origin",
        "warn",
        `set to ${fallback.origin}, expected ${expectedFallback}.`
      );
    } else if (fallback.status !== "active") {
      record(
        "fallback origin",
        "warn",
        `${fallback.origin} (${fallback.status})`
      );
    } else {
      record("fallback origin", "ok", `${fallback.origin} (active)`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record("fallback origin", "fail", msg);
  }

  // 7. Custom hostnames + orphan detection
  try {
    const hostnames = await cf.listCustomHostnames(zoneId);
    const suffix = `.${cfg.devSubdomain}`;
    const orphans = hostnames.filter((h) => !h.hostname.endsWith(suffix));
    const matching = hostnames.length - orphans.length;

    if (hostnames.length === 0) {
      record("custom hostnames", "ok", "none registered");
    } else if (orphans.length === 0) {
      record("custom hostnames", "ok", `${matching} on ${cfg.devSubdomain}`);
    } else {
      record(
        "custom hostnames",
        "warn",
        `${orphans.length} orphan(s) NOT on ${cfg.devSubdomain}: ${orphans.map((h) => h.hostname).join(", ")}`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record("custom hostnames", "fail", msg);
  }

  // 8. Docker
  await checkDocker(record);

  finish(checks, tally, asJson);
}

async function checkDocker(
  record: (name: string, status: CheckResult, detail: string) => void
): Promise<void> {
  if (!isDockerRunning()) {
    record("docker", "fail", "not running");
    return;
  }
  record("docker", "ok", "running");

  if (isStackRunning()) {
    record("devtun stack", "ok", "running (use `devtun down` to stop)");
  } else {
    record("devtun stack", "warn", "not running. Start it with `devtun up`.");
  }
}

function skipRemainingCloudflare(
  record: (name: string, status: CheckResult, detail: string) => void,
  skipZoneDependent = false
): void {
  if (skipZoneDependent) {
    record("tunnel", "skip", "skipped (zone access failed)");
  }
  record("cloudflare for SaaS", "skip", "skipped (cannot reach Cloudflare)");
  record("fallback origin", "skip", "skipped (cannot reach Cloudflare)");
  record("custom hostnames", "skip", "skipped (cannot reach Cloudflare)");
}
