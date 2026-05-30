import { vi } from "vitest";

export interface StdoutCapture {
  chunks: string[];
  text: () => string;
  json: <T = unknown>() => T;
  restore: () => void;
}

/**
 * Spy on process.stdout.write. Use for tests that need to verify JSON output
 * emitted via `process.stdout.write` (the only thing devtun writes there in
 * JSON mode).
 */
export function captureStdout(): StdoutCapture {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  return {
    chunks,
    text: () => chunks.join(""),
    json: <T = unknown>(): T => JSON.parse(chunks.join("")) as T,
    restore: () => {
      spy.mockRestore();
      process.stdout.write = original;
    },
  };
}
