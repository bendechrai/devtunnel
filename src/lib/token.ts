import { execFileSync } from "child_process";
import type { DevtunnelConfig } from "./types.js";

let cachedToken: string | null = null;

export function resolveToken(config?: DevtunnelConfig): string {
  if (cachedToken) return cachedToken;

  // 1. Environment variable
  const envToken = process.env["CLOUDFLARE_API_TOKEN"];
  if (envToken) {
    cachedToken = envToken;
    return envToken;
  }

  // 2. op:// reference in config
  if (config?.cfTokenSource) {
    const source = config.cfTokenSource;
    if (source.startsWith("op://")) {
      try {
        const resolved = execFileSync("op", ["read", source], {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        cachedToken = resolved;
        return resolved;
      } catch {
        throw new Error(
          `Failed to read token from 1Password (${source}).\n` +
          `Make sure the 1Password CLI is installed and you're signed in.`
        );
      }
    }
    // Treat as a literal token
    cachedToken = source;
    return cachedToken;
  }

  throw new Error(
    "No Cloudflare API token found.\n" +
    "Set CLOUDFLARE_API_TOKEN environment variable, or\n" +
    'add "cfTokenSource" to ~/.devtun/config.json'
  );
}
