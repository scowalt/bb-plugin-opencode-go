import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const CHAT_COMPLETIONS_URL =
  "https://opencode.ai/inference/go/openai/v1/chat/completions";
export const USER_AGENT = "bb-plugin-opencode-go/0.1.0";
export const DEFAULT_MODEL = "glm-5.3-flash";
export const ACCESS_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_TOKENS = 1024;
const ACCESS_FAILURE_STATUSES = new Set([401, 402, 403]);

const authFileSchema = z.object({
  "opencode-go": z.object({ type: z.literal("api"), key: z.string().min(1) }),
});

const completionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
});

const errorSchema = z.object({ error: z.object({ message: z.string() }) });

export type KeyResult =
  | { ok: true; key: string }
  | { ok: false; message: string };

export type ServiceStatus =
  | { ready: true }
  | { ready: false; message: string };

export function opencodeAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "auth.json");
}

export async function readOpencodeGoKey(
  env: NodeJS.ProcessEnv = process.env,
): Promise<KeyResult> {
  const fromFile = await readAuthFileKey(opencodeAuthPath(env));
  if (fromFile.ok) return fromFile;
  const fromEnv = env.OPENCODE_GO_API_KEY?.trim();
  return fromEnv ? { ok: true, key: fromEnv } : fromFile;
}

async function readAuthFileKey(path: string): Promise<KeyResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {
      ok: false,
      message: `No OpenCode Go key: run \`opencode auth login\` and choose OpenCode Go (looked in ${path})`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, message: `${path} is not valid JSON` };
  }
  const parsed = authFileSchema.safeParse(json);
  return parsed.success
    ? { ok: true, key: parsed.data["opencode-go"].key }
    : {
        ok: false,
        message: `No OpenCode Go key in ${path}: run \`opencode auth login\` and choose OpenCode Go`,
      };
}

interface ClientDeps {
  fetch: typeof fetch;
  readKey: () => Promise<KeyResult>;
  model: () => string;
  now: () => number;
}

export interface OpencodeGoClient {
  complete(prompt: string, signal: AbortSignal): Promise<string>;
  status(): Promise<ServiceStatus>;
}

async function upstreamMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const parsed = errorSchema.safeParse(json);
  const detail = parsed.success
    ? parsed.data.error.message
    : text.trim().slice(0, 300) || response.statusText;
  return `OpenCode Go HTTP ${response.status}: ${detail}`;
}

export function createOpencodeGoClient(deps: ClientDeps): OpencodeGoClient {
  let accessFailure: { message: string; at: number } | null = null;

  async function requireKey(): Promise<string> {
    const key = await deps.readKey();
    if (!key.ok) throw new Error(key.message);
    return key.key;
  }

  return {
    async complete(prompt, signal) {
      const key = await requireKey();
      const response = await deps.fetch(CHAT_COMPLETIONS_URL, {
        method: "POST",
        signal,
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "user-agent": USER_AGENT,
          "x-opencode-session": randomUUID(),
        },
        body: JSON.stringify({
          model: deps.model(),
          max_tokens: MAX_TOKENS,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) {
        const message = await upstreamMessage(response);
        if (ACCESS_FAILURE_STATUSES.has(response.status)) {
          accessFailure = { message, at: deps.now() };
        }
        throw new Error(message);
      }
      accessFailure = null;
      const parsed = completionSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("OpenCode Go returned an unexpected response shape");
      }
      return parsed.data.choices[0].message.content ?? "";
    },
    async status() {
      const key = await deps.readKey();
      if (!key.ok) return { ready: false, message: key.message };
      if (
        accessFailure !== null &&
        deps.now() - accessFailure.at < ACCESS_FAILURE_COOLDOWN_MS
      ) {
        return { ready: false, message: accessFailure.message };
      }
      return { ready: true };
    },
  };
}
