import * as cf from "../lib/cloudflare.js";
import * as out from "../lib/output.js";
import { configExists, loadConfig } from "../lib/config.js";
import { resolveToken } from "../lib/token.js";
import { isDockerRunning, isStackRunning } from "../lib/docker.js";
import type { DevtunnelConfig } from "../lib/types.js";

type CheckResult = "ok" | "warn" | "fail" | "skip";

interface Tally {
  ok: number;
  warn: number;
  fail: number;
  skip: number;
}

function record(tally: Tally, result: CheckResult): void {
  tally[result] += 1;
}

function report(name: string, result: CheckResult, detail: string): void {
  const label =
    result === "ok"
      ? "OK"
      : result === "warn"
        ? "WARN"
        : result === "fail"
          ? "FAIL"
          : "SKIP";
  const line = `[${label}] ${name}: ${detail}`;
  if (result === "ok") out.success(line);
  else if (result === "warn") out.warn(line);
  else if (result === "fail") out.error(line);
  else out.dim(line);
}

export async function doctor(): Promise<void> {
  out.header("devtun doctor");

  const tally: Tally = { ok: 0, warn: 0, fail: 0, skip: 0 };

  // 1. Config file
  if (!configExists()) {
    report("config file", "fail", "~/.devtun/config.json not found. Run `devtun setup`.");
    record(tally, "fail");
    summarize(tally);
    return;
  }

  let cfg: DevtunnelConfig;
  try {
    cfg = loadConfig();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report("config file", "fail", msg);
    record(tally, "fail");
    summarize(tally);
    return;
  }
  report("config file", "ok", `domain=${cfg.domain}, devSubdomain=${cfg.devSubdomain}`);
  record(tally, "ok");

  // 2. Cloudflare token
  let token: string;
  try {
    token = resolveToken(cfg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report("cloudflare token", "fail", msg);
    record(tally, "fail");
    skipRemainingCloudflare(tally);
    await checkDocker(tally);
    summarize(tally);
    return;
  }
  cf.setToken(token);
  report("cloudflare token", "ok", "resolved");
  record(tally, "ok");

  // 3. Zone access
  let zoneId: string | undefined;
  let accountId: string | undefined;
  try {
    const zone = await cf.getZone(cfg.domain);
    zoneId = zone.zoneId;
    accountId = zone.accountId;

    if (cfg.zoneId && cfg.zoneId !== zoneId) {
      report(
        "zone access",
        "warn",
        `resolved ${zoneId} but config has ${cfg.zoneId}. Run \`devtun setup\` to refresh.`
      );
      record(tally, "warn");
    } else if (cfg.accountId && cfg.accountId !== accountId) {
      report(
        "zone access",
        "warn",
        `resolved account ${accountId} but config has ${cfg.accountId}. Run \`devtun setup\` to refresh.`
      );
      record(tally, "warn");
    } else {
      report("zone access", "ok", `zone ${zoneId} on account ${accountId}`);
      record(tally, "ok");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report("zone access", "fail", msg);
    record(tally, "fail");
    skipRemainingCloudflare(tally, true);
    await checkDocker(tally);
    summarize(tally);
    return;
  }

  // 4. Tunnel
  try {
    const tunnel = await cf.findTunnel(accountId, cfg.tunnelName);
    if (!tunnel) {
      report(
        "tunnel",
        "fail",
        `no tunnel named '${cfg.tunnelName}' on this account. Run \`devtun setup\`.`
      );
      record(tally, "fail");
    } else if (cfg.tunnelId && cfg.tunnelId !== tunnel.id) {
      report(
        "tunnel",
        "warn",
        `found ${tunnel.id} but config has ${cfg.tunnelId}. Run \`devtun setup\` to refresh.`
      );
      record(tally, "warn");
    } else {
      report("tunnel", "ok", `'${cfg.tunnelName}' (${tunnel.id}, ${tunnel.status})`);
      record(tally, "ok");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report("tunnel", "fail", msg);
    record(tally, "fail");
  }

  // 5. SaaS enabled
  const saasEnabled = await cf.isSaasEnabled(zoneId);
  if (saasEnabled) {
    report("cloudflare for SaaS", "ok", "enabled");
    record(tally, "ok");
  } else {
    report(
      "cloudflare for SaaS",
      "fail",
      "not enabled. Enable it in the Cloudflare dashboard, then run `devtun setup`."
    );
    record(tally, "fail");
  }

  // 6. Fallback origin
  const expectedFallback = `tunnel-origin.${cfg.domain}`;
  try {
    const fallback = await cf.getFallbackOrigin(zoneId);
    if (!fallback) {
      report("fallback origin", "fail", `not configured. Expected ${expectedFallback}.`);
      record(tally, "fail");
    } else if (fallback.origin !== expectedFallback) {
      report(
        "fallback origin",
        "warn",
        `set to ${fallback.origin}, expected ${expectedFallback}.`
      );
      record(tally, "warn");
    } else if (fallback.status !== "active") {
      report("fallback origin", "warn", `${fallback.origin} (${fallback.status})`);
      record(tally, "warn");
    } else {
      report("fallback origin", "ok", `${fallback.origin} (active)`);
      record(tally, "ok");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report("fallback origin", "fail", msg);
    record(tally, "fail");
  }

  // 7. Custom hostnames + orphan detection
  try {
    const hostnames = await cf.listCustomHostnames(zoneId);
    const suffix = `.${cfg.devSubdomain}`;
    const orphans = hostnames.filter((h) => !h.hostname.endsWith(suffix));
    const matching = hostnames.length - orphans.length;

    if (hostnames.length === 0) {
      report("custom hostnames", "ok", "none registered");
      record(tally, "ok");
    } else if (orphans.length === 0) {
      report(
        "custom hostnames",
        "ok",
        `${matching} on ${cfg.devSubdomain}`
      );
      record(tally, "ok");
    } else {
      report(
        "custom hostnames",
        "warn",
        `${orphans.length} orphan(s) NOT on ${cfg.devSubdomain}: ${orphans.map((h) => h.hostname).join(", ")}`
      );
      record(tally, "warn");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report("custom hostnames", "fail", msg);
    record(tally, "fail");
  }

  // 8. Docker
  await checkDocker(tally);

  summarize(tally);
}

async function checkDocker(tally: Tally): Promise<void> {
  if (!isDockerRunning()) {
    report("docker", "fail", "not running");
    record(tally, "fail");
    return;
  }
  report("docker", "ok", "running");
  record(tally, "ok");

  if (isStackRunning()) {
    report("devtun stack", "ok", "running (use `devtun down` to stop)");
    record(tally, "ok");
  } else {
    report("devtun stack", "warn", "not running. Start it with `devtun up`.");
    record(tally, "warn");
  }
}

function skipRemainingCloudflare(tally: Tally, skipZoneDependent = false): void {
  if (skipZoneDependent) {
    report("tunnel", "skip", "skipped (zone access failed)");
    record(tally, "skip");
  }
  report("cloudflare for SaaS", "skip", "skipped (cannot reach Cloudflare)");
  record(tally, "skip");
  report("fallback origin", "skip", "skipped (cannot reach Cloudflare)");
  record(tally, "skip");
  report("custom hostnames", "skip", "skipped (cannot reach Cloudflare)");
  record(tally, "skip");
}

function summarize(tally: Tally): void {
  out.blank();
  out.info(
    `${tally.ok} ok, ${tally.warn} warning(s), ${tally.fail} failure(s)${tally.skip ? `, ${tally.skip} skipped` : ""}`
  );
  out.blank();
  if (tally.fail > 0) process.exit(1);
}
