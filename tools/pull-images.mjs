import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PULL_ATTEMPTS = 3;
export const PULL_BACKOFF_SECONDS = [15, 30];
export const PULL_ATTEMPT_SECONDS = 240;
export const PULL_BUDGET_SECONDS = 420;

export function dockerPull(image, timeoutSeconds) {
  const result = spawnSync("docker", ["pull", image], { stdio: ["ignore", "inherit", "inherit"], timeout: timeoutSeconds * 1000 });
  if (result.status === 0) return { pulled: true };
  return { pulled: false, reason: result.error?.message ?? (result.signal ? `stopped by ${result.signal}` : `exit ${result.status}`) };
}

const pause = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Pulls each image, retrying a failed registry request, and fails once an image stays unavailable or the budget is spent.
export async function pullImages(images, { pull = dockerPull, sleep = pause, now = Date.now, log = console.error } = {}) {
  if (images.length === 0) throw new Error("No image to pull");
  const started = now();
  const left = () => PULL_BUDGET_SECONDS - (now() - started) / 1000;
  for (const image of images) {
    for (let attempt = 1; ; attempt++) {
      if (left() <= 0) throw new Error(`Pulling ${image} exceeded the ${PULL_BUDGET_SECONDS} s budget`);
      const result = pull(image, Math.min(PULL_ATTEMPT_SECONDS, Math.ceil(left())));
      if (result.pulled) break;
      if (attempt === PULL_ATTEMPTS) throw new Error(`${image} could not be pulled after ${attempt} attempts: ${result.reason}`);
      const wait = PULL_BACKOFF_SECONDS[attempt - 1];
      log(`Pulling ${image} failed (${result.reason}), attempt ${attempt + 1} of ${PULL_ATTEMPTS} in ${wait} s`);
      await sleep(wait);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await pullImages(process.argv.slice(2).flatMap((argument) => argument.split(/\s+/)).filter(Boolean));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
