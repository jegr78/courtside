import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadJson } from "./downloadJson";

describe("downloadJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function offer(): { revoked: () => number; anchor: HTMLAnchorElement | undefined } {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:courtside/answer", revokeObjectURL
    });
    let anchor: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      anchor = document.querySelector("a") ?? undefined;
    });
    downloadJson("courtside-subject-access-person-1.json", { personId: "person-1" });
    return { revoked: () => revokeObjectURL.mock.calls.length, anchor };
  }

  it("given a file to hand over, when it is offered, then it is named and pointed at the content", () => {
    // when
    const { anchor } = offer();

    // then
    expect(anchor?.download).toBe("courtside-subject-access-person-1.json");
    expect(anchor?.getAttribute("href")).toBe("blob:courtside/answer");
    expect(document.querySelector("a")).toBeNull();
  });

  it("given a browser that reads the content after the click returns, when a file is offered, then its address stays valid", () => {
    // when
    const { revoked } = offer();

    // then
    expect(revoked()).toBe(0);
  });
});
