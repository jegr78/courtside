import { test, expect } from "@playwright/test";
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { anonymousApi } from "../lib/api";
import { readZip } from "../lib/redaction.mjs";

// Built at run time, because a trace carries the test source.
const SECRET = [..."9&drow ssap!derahS"].reverse().join("");
const MARKER = "traced-marker-request";
let tracedIn = "";

test.describe.configure({ mode: "serial" });
test.use({ trace: "on" });
const body = (request: IncomingMessage) => new Promise<string>((done) => { let text = ""; request.on("data", (chunk) => text += chunk); request.on("end", () => done(text)); });

test("given an instance with a session cookie, when the API signs in and reauthenticates, then the session works and no trace entry carries the password", async ({}, info) => {
  // given
  let session = "anonymous";
  const server = createServer(async (request, response) => {
    const sent = await body(request);
    const cookie = request.headers.cookie ?? "";
    const xsrf = request.headers["x-xsrf-token"] === "token";
    if (request.method === "POST" && request.url === "/api/session" && xsrf && new URLSearchParams(sent).get("password") === SECRET) {
      session = "first"; response.setHeader("set-cookie", "SESSION=first; Path=/; HttpOnly; SameSite=Lax");
    } else if (request.method === "POST" && request.url === "/api/session/reauthentication" && xsrf && cookie.includes("SESSION=first") && JSON.parse(sent).password === SECRET) {
      session = "rotated"; response.setHeader("set-cookie", "SESSION=rotated; Path=/; HttpOnly; SameSite=Lax");
    } else if (request.method === "GET") {
      response.setHeader("set-cookie", "XSRF-TOKEN=token; Path=/");
    } else { response.statusCode = 403; }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ authenticated: session !== "anonymous" && cookie.includes(`SESSION=${session}`) }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = await anonymousApi(base);
  tracedIn = info.outputDir;

  // when
  const signedIn = await api.credential("/api/session", { form: { username: "jane.doe", password: SECRET } });
  const reauthenticated = await api.credential("/api/session/reauthentication", { json: { password: SECRET } });
  const after = await (await api.get(`/api/session?${MARKER}`)).json() as { authenticated: boolean };

  // then
  server.close();
  expect(signedIn.status(), "the form sign-in is accepted").toBe(200);
  expect(reauthenticated.status(), "the reauthentication carries the signed-in session").toBe(200);
  expect(after.authenticated, "the API context follows the rotated session").toBe(true);
});

test("given the traced sign-in, when its trace is read, then it shows the API requests but never the password", () => {
  // given
  const entries = readZip(readFileSync(`${tracedIn}/trace.zip`));
  const all = entries.map((entry) => entry.data.toString("latin1")).join("\n");
  // then
  expect(all.includes(MARKER), "the API context was traced, so the absence below means something").toBe(true);
  expect(all.includes(SECRET.slice(0, 11)), "no trace entry holds the password").toBe(false);
  expect(all.includes(new URLSearchParams({ p: SECRET }).toString().slice(2, 15)), "nor its form-encoded body").toBe(false);
});
