import * as out from "../lib/output.js";
import { loadConfig } from "../lib/config.js";
import { composeDown } from "../lib/docker.js";

export async function down(): Promise<void> {
  loadConfig(); // validate config exists
  composeDown();

  out.blank();
  out.success("devtun stopped.");
  out.blank();
}
