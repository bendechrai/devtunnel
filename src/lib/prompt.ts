import { createInterface } from "readline";

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

export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} [y/N] `);
  return answer.toLowerCase() === "y";
}

export async function waitForEnter(message: string): Promise<void> {
  await ask(`${message}\nPress Enter to continue...`);
}
