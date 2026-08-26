import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const gateway = fileURLToPath(new URL("security-request-gateway.py", import.meta.url));

async function startGateway() {
  const process = spawn("python3", [gateway], {
    env: {
      ...globalThis.process.env,
      COURTSIDE_SECURITY_GATEWAY_PORT: "0",
      COURTSIDE_SECURITY_MAX_REQUESTS: "50",
      COURTSIDE_SECURITY_MAX_CONCURRENCY: "2",
      COURTSIDE_SECURITY_MAX_GENERATED_BYTES: "1000000",
      COURTSIDE_SECURITY_ALLOWED_METHODS: "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
      COURTSIDE_SECURITY_ALLOWED_PATH_PREFIXES: "/api"
    },
    stdio: ["ignore", "pipe", "inherit"]
  });
  const lines = createInterface({ input: process.stdout });
  const [announcement] = await once(lines, "line");
  lines.close();
  return { process, port: Number(announcement.split(" ")[1]) };
}

async function send(port, method) {
  const attempt = request({ host: "127.0.0.1", port, method, path: "/api/public/config" });
  attempt.end();
  const [response] = await once(attempt, "response");
  response.resume();
  return response.statusCode;
}

test("a method the gateway does not relay is refused rather than answered as a server error",
  async () => {
    const { process, port } = await startGateway();
    try {
      assert.equal(await send(port, "TRACE"), 421);
      assert.equal(await send(port, "PROPFIND"), 421);
      assert.equal(await send(port, "QUERY"), 421);
    } finally {
      process.kill();
      await once(process, "exit");
    }
  });

test("a method the gateway relays reaches for its upstream", async () => {
  const { process, port } = await startGateway();
  try {
    // No upstream is running, so the relay attempt is what 502 reports.
    assert.equal(await send(port, "GET"), 502);
  } finally {
    process.kill();
    await once(process, "exit");
  }
});
