import * as out from "./output.js";

export interface HelpArg {
  name: string;
  description: string;
  required?: boolean;
}

export interface HelpFlag {
  name: string;
  aliases?: string[];
  description: string;
  default?: string;
  type?: "boolean" | "string";
}

export interface HelpEnv {
  name: string;
  description: string;
}

export interface HelpExit {
  code: number;
  meaning: string;
}

export interface HelpExample {
  description: string;
  command: string;
}

export interface HelpDoc {
  command: string;
  synopsis: string;
  description: string;
  args?: HelpArg[];
  flags?: HelpFlag[];
  env?: HelpEnv[];
  exits?: HelpExit[];
  examples?: HelpExample[];
}

export function isHelpRequested(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

export function printHelp(doc: HelpDoc): void {
  const lines: string[] = [];
  lines.push(`devtun ${doc.command}`);
  lines.push("");
  lines.push("SYNOPSIS");
  lines.push(`  ${doc.synopsis}`);
  lines.push("");
  lines.push("DESCRIPTION");
  for (const para of doc.description.split("\n")) {
    lines.push(`  ${para}`);
  }

  if (doc.args && doc.args.length > 0) {
    lines.push("");
    lines.push("ARGUMENTS");
    for (const a of doc.args) {
      const tag = a.required ? "required" : "optional";
      lines.push(`  ${a.name}  (${tag})`);
      lines.push(`      ${a.description}`);
    }
  }

  if (doc.flags && doc.flags.length > 0) {
    lines.push("");
    lines.push("FLAGS");
    for (const f of doc.flags) {
      const aliases = f.aliases?.length
        ? ", " + f.aliases.map((a) => (a.length === 1 ? `-${a}` : `--${a}`)).join(", ")
        : "";
      const typed = f.type === "string" ? "=<value>" : "";
      const def = f.default ? ` (default: ${f.default})` : "";
      lines.push(`  --${f.name}${typed}${aliases}`);
      lines.push(`      ${f.description}${def}`);
    }
  }

  if (doc.env && doc.env.length > 0) {
    lines.push("");
    lines.push("ENVIRONMENT");
    for (const e of doc.env) {
      lines.push(`  ${e.name}`);
      lines.push(`      ${e.description}`);
    }
  }

  if (doc.exits && doc.exits.length > 0) {
    lines.push("");
    lines.push("EXIT CODES");
    for (const x of doc.exits) {
      lines.push(`  ${x.code}  ${x.meaning}`);
    }
  }

  if (doc.examples && doc.examples.length > 0) {
    lines.push("");
    lines.push("EXAMPLES");
    for (const ex of doc.examples) {
      lines.push(`  # ${ex.description}`);
      lines.push(`  ${ex.command}`);
      lines.push("");
    }
  }

  console.log(lines.join("\n"));
}

export function printJsonHelp(doc: HelpDoc): void {
  out.setJsonMode(true);
  out.json(doc);
}

/**
 * If args includes --help/-h, print the help (JSON if --json is also present)
 * and return true. Otherwise return false. Use early in each command:
 *
 *   if (handleHelp(args, addHelp)) return;
 */
export function handleHelp(args: string[], doc: HelpDoc): boolean {
  if (!isHelpRequested(args)) return false;
  if (args.includes("--json")) {
    printJsonHelp(doc);
  } else {
    printHelp(doc);
  }
  return true;
}
