import { describe, expect, it } from "vitest";
import { returnSearch, returnTarget, returnTargetIn, signInPath } from "./returnTarget";

describe("returnTarget", () => {
  it.each([
    "/my-bookings",
    "/my-bookings#booking-70000000-0000-0000-0000-000000000001",
    "/my-messages?page=2#latest",
    "/account/security"
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
    ["a malformed escape", "/my-bookings%E0%A4%A"]
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
