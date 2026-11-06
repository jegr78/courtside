import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api/client";
import { HomeView } from "./HomeView";

const weekView = vi.hoisted(() => vi.fn<(props: { canChooseSeveralCourts?: boolean }) => null>(() => null));
vi.mock("./WeekView", () => ({ WeekView: weekView }));
vi.mock("../club/registry", () => ({ useClubConfiguration: () => ({ club: undefined }) }));

function session(roles: SessionStatus["roles"]): SessionStatus {
  return { authenticated: true, username: "doe.jane", roles, passwordChangeRequired: false };
}

describe("HomeView", () => {
  it.each([
    [["MEMBER"], false],
    [["EXTERNAL"], false],
    [["MEMBER", "EXTERNAL"], false],
    [["TRAINER"], true],
    [["EXTERNAL", "TRAINER"], true]
  ] as const)("given the roles %j, when the court plan opens, then choosing several courts is %s", (roles, expected) => {
    // when
    render(<MemoryRouter><HomeView session={session([...roles])} /></MemoryRouter>);

    // then
    expect(weekView.mock.lastCall?.[0].canChooseSeveralCourts).toBe(expected);
  });
});
