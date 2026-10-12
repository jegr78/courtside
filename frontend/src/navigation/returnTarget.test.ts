import { describe, expect, it } from "vitest";
import { currentSignInPath, returnSearch, returnTarget, returnTargetIn, signInPath } from "./returnTarget";

describe("returnTarget", () => {
  it.each([
    "/my-bookings",
    "/my-bookings#booking-70000000-0000-0000-0000-000000000001",
    "/my-messages?page=2#latest",
    "/account/security",
    "/my-messages?q=a%20b",
    "/my-messages/a%20b",
    "/my-bookings?x=%2F%2Fattacker.example",
    "/my-bookings#%2F%2Fattacker.example",
    "/my-bookings?x=..%2F..",
    "/admin/roster?q=a%5Cb"
  ])("given the same-origin path %s, when it is read as a return target, then it is kept", (candidate) => {
    // when
    const target = returnTarget(candidate);

    // then
    expect(target, "a relative same-origin path is a place to return to").toBe(candidate);
  });

  it.each([
    ["nothing", undefined],
    ["an empty value", ""],
    ["a path without a leading slash", "my-bookings"],
    ["a protocol-relative host", "//attacker.example/my-bookings"],
    ["a backslash host", "/\\attacker.example"],
    ["two backslashes", "/\\\\attacker.example"],
    ["an absolute URL", "https://attacker.example/my-bookings"],
    ["a script URL", "javascript:alert(1)"],
    ["a tab the browser drops", "/\t/attacker.example"],
    ["a newline the browser drops", "/\n/attacker.example"],
    ["a carriage return", "/my-bookings\r"],
    ["a null character", "/my-bookings\u0000"],
    ["a delete character", "/my-bookings\u007f"],
    ["encoded slashes", "/%2F%2Fattacker.example"],
    ["an encoded slash after the first", "/%2Fattacker.example"],
    ["an encoded backslash", "/%5Cattacker.example"],
    ["an encoded tab", "/%09/attacker.example"],
    ["an encoded newline", "/my-bookings%0A"],
    ["doubly encoded slashes", "/%252F%252Fattacker.example"],
    ["a malformed escape", "/my-bookings%E0%A4%A"],
    ["a malformed escape in the query", "/my-bookings?x=%E0%A4%A"],
    ["a backslash inside the path", "/my-bookings\\..\\attacker"],
    ["an encoded backslash inside the path", "/my-bookings%5Cattacker"],
    ["a dot segment", "/./my-bookings"],
    ["a parent segment", "/my-bookings/../admin"],
    ["a trailing parent segment", "/my-bookings/.."],
    ["an encoded parent segment", "/my-bookings/%2E%2E/admin"],
    ["a doubly encoded parent segment", "/my-bookings/%252E%252E/admin"],
    ["a fullwidth solidus", "/\uff0fattacker.example"],
    ["a fullwidth reverse solidus", "/\uff3cattacker.example"],
    ["a fullwidth parent segment", "/my-bookings/\uff0e\uff0e/admin"],
    ["an encoded tab in the query", "/my-bookings?x=%09"],
    ["an encoded newline in the fragment", "/my-bookings#%0A"],
    ["a raw tab in the fragment", "/my-bookings#a\tb"],
    ["more encoding layers than are unwrapped", "/%25252525252F"]
  ])("given %s, when it is read as a return target, then the start page is used instead", (_, candidate) => {
    // when
    const target = returnTarget(candidate);

    // then
    expect(target, `${JSON.stringify(candidate)} could leave the origin or hide where it leads`).toBeUndefined();
  });
});

describe("signInPath", () => {
  it("given a page with a fragment, when sign-in is required, then the whole address travels in one parameter", () => {
    // when
    const path = signInPath({ pathname: "/my-bookings", search: "?view=past", hash: "#booking-42" });

    // then
    expect(path).toBe("/login?returnTo=%2Fmy-bookings%3Fview%3Dpast%23booking-42");
    expect(returnTargetIn(path.slice("/login".length)), "the encoded target reads back unchanged")
      .toBe("/my-bookings?view=past#booking-42");
  });
});

describe("currentSignInPath", () => {
  it("given the browser on a booking, when sign-in is required, then the booking travels as the target", () => {
    // given
    window.history.replaceState(null, "", "/my-bookings#booking-42");

    // when
    const path = currentSignInPath();

    // then
    expect(path, "the page the session ended on is where sign-in returns").toBe("/login?returnTo=%2Fmy-bookings%23booking-42");
  });
});

describe("signInPath", () => {
  it.each([
    ["the start page", { pathname: "/", search: "", hash: "" }, "/login"],
    ["the sign-in form with a target", { pathname: "/login", search: "?returnTo=%2Fmy-bookings", hash: "" }, "/login?returnTo=%2Fmy-bookings"],
    ["the one-time password form with a target", { pathname: "/initial-password", search: "?returnTo=%2Fmy-bookings", hash: "" }, "/login?returnTo=%2Fmy-bookings"],
    ["account recovery with a target", { pathname: "/account-recovery", search: "?returnTo=%2Fmy-bookings", hash: "" }, "/login?returnTo=%2Fmy-bookings"],
    ["the sign-in form without a target", { pathname: "/login", search: "", hash: "" }, "/login"],
    ["an address that could leave the origin", { pathname: "//attacker.example", search: "", hash: "" }, "/login"]
  ])("given %s, when sign-in is required, then only a usable target travels", (_, address, expected) => {
    // when
    const path = signInPath(address);

    // then
    expect(path, "a sign-in step passes its own target on and never names itself").toBe(expected);
  });
});

describe("returnSearch", () => {
  it("given a valid return target among other parameters, when it is carried on, then only the target travels", () => {
    // when
    const search = returnSearch("?returnTo=%2Fmy-bookings%23booking-42&other=1");

    // then
    expect(search).toBe("?returnTo=%2Fmy-bookings%23booking-42");
  });

  it.each([
    ["no target", ""],
    ["a protocol-relative host", "?returnTo=%2F%2Fattacker.example"],
    ["a tab", "?returnTo=%2F%09%2Fattacker.example"]
  ])("given %s, when the search is carried on, then nothing travels", (_, search) => {
    // when
    const carried = returnSearch(search);

    // then
    expect(carried, "an unusable target is dropped rather than handed to the next step").toBe("");
  });
});
