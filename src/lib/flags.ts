export interface FlagSpec {
  boolean?: string[];
  string?: string[];
  aliases?: Record<string, string>;
}

export interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Tiny argv parser. Supports:
 *   --foo            -> boolean true (if in spec.boolean) OR error
 *   --foo=bar        -> string value
 *   --foo bar        -> string value (if --foo is in spec.string)
 *   --no-foo         -> boolean false (only for spec.boolean entries)
 *   -f               -> resolved via spec.aliases
 *   --               -> stop parsing; remaining args become positional
 * Throws on unknown flags so typos surface loudly.
 */
export function parseFlags(args: string[], spec: FlagSpec = {}): ParsedFlags {
  const booleanSet = new Set(spec.boolean ?? []);
  const stringSet = new Set(spec.string ?? []);
  const aliases = spec.aliases ?? {};

  const resolveName = (raw: string): string => aliases[raw] ?? raw;

  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  let stopFlags = false;

  while (i < args.length) {
    const arg = args[i];

    if (stopFlags) {
      positional.push(arg);
      i++;
      continue;
    }

    if (arg === "--") {
      stopFlags = true;
      i++;
      continue;
    }

    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");

      if (eq >= 0) {
        const rawName = body.slice(0, eq);
        const value = body.slice(eq + 1);
        const name = resolveName(rawName);
        if (!stringSet.has(name) && !booleanSet.has(name)) {
          throw new Error(`Unknown flag: --${rawName}`);
        }
        flags[name] = stringSet.has(name) ? value : value !== "false";
        i++;
        continue;
      }

      if (body.startsWith("no-")) {
        const rawName = body.slice(3);
        const name = resolveName(rawName);
        if (!booleanSet.has(name)) {
          throw new Error(`Unknown flag: --${body}`);
        }
        flags[name] = false;
        i++;
        continue;
      }

      const name = resolveName(body);
      if (stringSet.has(name)) {
        const next = args[i + 1];
        if (next === undefined || next.startsWith("-")) {
          throw new Error(`Flag --${body} requires a value`);
        }
        flags[name] = next;
        i += 2;
        continue;
      }
      if (booleanSet.has(name)) {
        flags[name] = true;
        i++;
        continue;
      }
      throw new Error(`Unknown flag: --${body}`);
    }

    if (arg.startsWith("-") && arg.length > 1 && arg !== "-") {
      const short = arg.slice(1);
      const name = resolveName(short);
      if (stringSet.has(name)) {
        const next = args[i + 1];
        if (next === undefined || next.startsWith("-")) {
          throw new Error(`Flag -${short} requires a value`);
        }
        flags[name] = next;
        i += 2;
        continue;
      }
      if (booleanSet.has(name)) {
        flags[name] = true;
        i++;
        continue;
      }
      throw new Error(`Unknown flag: -${short}`);
    }

    positional.push(arg);
    i++;
  }

  return { positional, flags };
}
