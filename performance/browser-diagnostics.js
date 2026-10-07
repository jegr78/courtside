import { problemParts } from "./http-diagnostics.js";

const textLimit = 300;

function pathOf(url, target) {
  return url.replace(target, "").split("?")[0];
}

function bounded(text) {
  return text.length > textLimit ? `${text.slice(0, textLimit)}...` : text;
}

export function failedRequest(request, target) {
  const path = pathOf(request.url(), target);
  const errorText = request.failure()?.errorText;
  const expectedEmptyMutation = errorText === "net::ERR_ABORTED"
    && ((request.method() === "POST" && path === "/api/session")
      || (request.method() === "DELETE" && path.startsWith("/api/bookings/")));
  if (expectedEmptyMutation) return undefined;
  return `request failed: ${request.method()} ${path} ${errorText ?? "without an error text"}`;
}

export function consoleFailure(message) {
  if (message.type() !== "error") return undefined;
  return `console error: ${bounded(message.text())}`;
}

export function refusedResponse(response, target) {
  if (response.status() < 400) return undefined;
  return `response ${response.status()}: ${response.request().method()} ${pathOf(response.url(), target)}`;
}

export async function refusal(label, response) {
  const problem = await response.json().catch(() => undefined);
  if (problem === null || typeof problem !== "object") {
    return `${label} returned status ${response.status()} without a readable problem body`;
  }
  return [`${label} returned status ${response.status()}`, ...problemParts(problem)].join(" ");
}

export function journeyFailure(step, error, elapsedMilliseconds, pageUrl, target) {
  return `Browser journey failed at ${step} after ${elapsedMilliseconds} ms on ${pathOf(pageUrl, target) || "/"} : ${bounded(String(error))}`;
}
