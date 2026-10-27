import { beforeEach, expect, it, vi } from "vitest";
import { startJourneyService } from "./global-setup";

const boundary = vi.hoisted(() => ({ prepare: vi.fn(), mkdir: vi.fn(), images: ["example/browser", "example/mail"] }));
vi.mock("./image-preparation", () => ({ prepareBrowserImages: boundary.prepare }));
vi.mock("./container-images", async (original) => ({ ...await original<typeof import("./container-images")>(),
  browserSetupImages: () => boundary.images }));
vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>(), mkdirSync: boundary.mkdir }));

beforeEach(() => { vi.resetAllMocks(); });

it("given image preparation is pending, when the journey service starts, then no resource starts until every image is ready", async () => {
  // given
  let ready!: () => void;
  boundary.prepare.mockReturnValueOnce(new Promise<void>((resolve) => { ready = resolve; }));
  const reached = new Error("Journey resource startup reached");
  boundary.mkdir.mockImplementation(() => { throw reached; });

  // when
  const started = startJourneyService().catch((error: unknown) => error);
  await Promise.resolve();

  // then
  expect(boundary.prepare).toHaveBeenCalledExactlyOnceWith(boundary.images);
  expect(boundary.mkdir, "resource startup waits for image preparation").not.toHaveBeenCalled();
  ready();
  expect(await started).toBe(reached);
  expect(boundary.mkdir).toHaveBeenCalledOnce();
});

it("given image preparation rejects, when the journey service starts, then its original error returns before any resource starts", async () => {
  // given
  const failure = new Error("browser image unavailable");
  boundary.prepare.mockRejectedValueOnce(failure);

  // when / then
  await expect(startJourneyService()).rejects.toBe(failure);
  expect(boundary.mkdir).not.toHaveBeenCalled();
});
