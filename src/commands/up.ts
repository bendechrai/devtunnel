import * as out from "../lib/output.js";
import { loadConfig, writeEnvFile } from "../lib/config.js";
import { writeInfraCompose } from "../lib/compose.js";
import { composeUp } from "../lib/docker.js";

export async function up(): Promise<void> {
  const config = loadConfig();

  if (!config.tunnelToken) {
    throw new Error("No tunnel token found. Run 'devtun setup' first.");
  }

  writeInfraCompose();
  writeEnvFile({ TUNNEL_TOKEN: config.tunnelToken });
  composeUp();

  out.blank();
  out.success("devtun is running.");
  out.info("Traefik dashboard: http://localhost:8080");
  out.blank();
}
