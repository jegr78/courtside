import { describe, expect, test } from "vitest";
import { createAppRouter } from "./router";

describe("the application router", () => {
  test("givenAViewThatHoldsUnsavedWork_whenItBlocksNavigation_thenTheLocationDoesNotChange", async () => {
    // given
    const router = createAppRouter();
    router.getBlocker("unsaved-work", () => true);

    // when
    await router.navigate("/login");

    // then
    expect(router.state.blockers.get("unsaved-work")?.state).toBe("blocked");
    expect(router.state.location.pathname).toBe("/");
  });
});
