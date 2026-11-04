import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ACCESS_FAILURE_COOLDOWN_MS,
  CHAT_COMPLETIONS_URL,
  createOpencodeGoClient,
  readOpencodeGoKey,
  type KeyResult,
} from "../opencode-go.ts";

interface Call {
  url: string;
  init: RequestInit;
}

function harness(responses: Response[], key: KeyResult = { ok: true, key: "k-1" }) {
  const calls: Call[] = [];
  let clock = 1_000;
  const client = createOpencodeGoClient({
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift();
      if (next === undefined) throw new Error("unexpected fetch");
      return next;
    },
    readKey: async () => key,
    model: () => "deepseek-v4.1-flash",
    now: () => clock,
  });
  return { client, calls, advance: (ms: number) => (clock += ms) };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("sends the prompt to the Go chat endpoint and returns the reply text", async () => {
  const { client, calls } = harness([
    json(200, { choices: [{ message: { content: "Fix flaky reconnect test" } }] }),
  ]);
  const text = await client.complete("title this", new AbortController().signal);
  assert.equal(text, "Fix flaky reconnect test");
  assert.equal(calls[0].url, CHAT_COMPLETIONS_URL);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), "Bearer k-1");
  assert.match(headers.get("user-agent") ?? "", /^bb-plugin-opencode-go\//);
  assert.ok(headers.get("x-opencode-session"));
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, "deepseek-v4.1-flash");
  assert.deepEqual(body.messages, [{ role: "user", content: "title this" }]);
});

test("an inactive subscription fails the call and marks the service not ready until the cooldown ends", async () => {
  const message = "An active OpenCode Go subscription is required to use Go models.";
  const { client, advance } = harness([
    json(403, { error: { type: "server_error", message } }),
  ]);
  await assert.rejects(
    client.complete("p", new AbortController().signal),
    new RegExp(`HTTP 403: ${message}`),
  );
  const status = await client.status();
  assert.equal(status.ready, false);
  assert.match(status.ready ? "" : status.message, /subscription is required/);
  advance(ACCESS_FAILURE_COOLDOWN_MS);
  assert.deepEqual(await client.status(), { ready: true });
});

test("a server error fails the call without marking the service not ready", async () => {
  const { client } = harness([new Response("bad gateway", { status: 502 })]);
  await assert.rejects(
    client.complete("p", new AbortController().signal),
    /HTTP 502: bad gateway/,
  );
  assert.deepEqual(await client.status(), { ready: true });
});

test("a missing key is reported by status and by complete without calling the API", async () => {
  const { client, calls } = harness([], { ok: false, message: "No OpenCode Go key" });
  assert.deepEqual(await client.status(), { ready: false, message: "No OpenCode Go key" });
  await assert.rejects(client.complete("p", new AbortController().signal), /No OpenCode Go key/);
  assert.equal(calls.length, 0);
});

test("prefers the key opencode auth login stored over a stale OPENCODE_GO_API_KEY", async () => {
  const dataHome = await mkdtemp(join(tmpdir(), "opencode-go-"));
  const env = { XDG_DATA_HOME: dataHome };
  assert.equal((await readOpencodeGoKey(env)).ok, false);
  assert.deepEqual(
    await readOpencodeGoKey({ ...env, OPENCODE_GO_API_KEY: "env-key" }),
    { ok: true, key: "env-key" },
  );
  await mkdir(join(dataHome, "opencode"));
  await writeFile(
    join(dataHome, "opencode", "auth.json"),
    JSON.stringify({ openai: { type: "oauth" }, "opencode-go": { type: "api", key: "file-key" } }),
  );
  assert.deepEqual(await readOpencodeGoKey(env), { ok: true, key: "file-key" });
  assert.deepEqual(
    await readOpencodeGoKey({ ...env, OPENCODE_GO_API_KEY: "env-key" }),
    { ok: true, key: "file-key" },
  );
});
