import { createInterface } from "readline";

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().replace(/^["']|["']$/g, ""));
    });
  });
}

export interface ConfirmOptions {
  /** Value to return when stdin/stdout aren't a TTY. If omitted, throws. */
  defaultWhenNonInteractive?: boolean;
}

export async function confirm(
  question: string,
  opts: ConfirmOptions = {}
): Promise<boolean> {
  if (!isInteractive()) {
    if (opts.defaultWhenNonInteractive === undefined) {
      throw new Error(
        `Cannot prompt "${question}" outside an interactive terminal. Pass an explicit flag.`
      );
    }
    return opts.defaultWhenNonInteractive;
  }
  const answer = await ask(`${question} [y/N] `);
  return answer.toLowerCase() === "y";
}

export async function waitForEnter(message: string): Promise<void> {
  await ask(`${message}\nPress Enter to continue...`);
}
