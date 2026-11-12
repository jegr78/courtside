import { describe, expect, it } from "vitest";
import { adminPageLoader, adminPages } from "./adminPages";

describe("adminPageLoader", () => {
  it("given an address with an identifier, when it is looked up, then the page declared with a parameter is found", () => {
    // when
    const loader = adminPageLoader("/admin/roster/00000000-0000-0000-0000-000000000000");

    // then
    expect(loader).toBe(adminPages["/admin/roster/:personId"]);
  });

  it("given an address outside the administration's pages, when it is looked up, then nothing is loaded", () => {
    // when
    const loaders = ["/", "/admin/unknown", "/admin/facility", "/my-bookings"].map(adminPageLoader);

    // then
    expect(loaders).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("given the overview's address, when its loader runs, then it yields the overview component", async () => {
    // when
    const loaded = await adminPageLoader("/admin")?.();

    // then
    expect((loaded?.default as { name?: string } | undefined)?.name).toBe("AdminOverviewView");
  });
});
