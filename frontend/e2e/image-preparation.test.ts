import { describe, expect, it, vi } from "vitest";
import { prepareBrowserImages, type ImageCommandResult } from "./image-preparation";

const cached: ImageCommandResult = { exitCode: 0, reason: "" };
const missing: ImageCommandResult = { exitCode: 1, reason: "Error response from daemon: No such image: example/browser:1" };

describe("browser image preparation", () => {
  it("given cached and missing images, when setup prepares them, then only missing images are pulled once with progress", async () => {
    // given
    const log = vi.fn();
    const run = vi.fn((args: string[]) => Promise.resolve(args[0] === "image" && args.at(-1) !== "cached" ? missing : cached));

    // when
    await prepareBrowserImages(["cached", "browser", "browser", "mail"], { run, log });

    // then
    expect(run.mock.calls).toEqual([
      [["image", "inspect", "cached"], false],
      [["image", "inspect", "browser"], false],
      [["pull", "browser"], true],
      [["image", "inspect", "mail"], false],
      [["pull", "mail"], true]
    ]);
    expect(log.mock.calls.flat().join("\n")).toContain("Pulling browser");
    expect(log.mock.calls.flat().join("\n")).toContain("Pulling mail");
  });

  it("given an image pull fails, when setup prepares images, then the image and reason stop all later work", async () => {
    // given
    const run = vi.fn((args: string[]) => Promise.resolve(args[0] === "pull"
      ? { exitCode: 1, reason: "manifest unavailable" } : missing));

    // when / then
    await expect(prepareBrowserImages(["browser", "mail"], { run, log: vi.fn() }))
      .rejects.toThrow("Could not pull browser: manifest unavailable");
    expect(run.mock.calls.map(([args]) => args)).toEqual([["image", "inspect", "browser"], ["pull", "browser"]]);
  });

  it("given Docker cannot inspect its cache, when setup prepares images, then it fails without treating the daemon error as a missing image", async () => {
    // given
    const run = vi.fn(() => Promise.resolve({ exitCode: 1, reason: "Cannot connect to the Docker daemon" }));

    // when / then
    await expect(prepareBrowserImages(["browser"], { run, log: vi.fn() }))
      .rejects.toThrow("Could not inspect browser: Cannot connect to the Docker daemon");
    expect(run).toHaveBeenCalledOnce();
  });
});
