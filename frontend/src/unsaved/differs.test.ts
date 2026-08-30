import { expect, it } from "vitest";
import { differs } from "./differs";

it("given the same values in another order, when comparing, then nothing is unsaved", () => {
  // then
  expect(differs({ name: "Court 1", number: 1 }, { number: 1, name: "Court 1" })).toBe(false);
});

it("given one field edited, when comparing, then it is unsaved", () => {
  // then
  expect(differs({ name: "Court 1", number: 1 }, { name: "Centre court", number: 1 })).toBe(true);
});

it("given a field the other side does not carry, when comparing, then it is unsaved", () => {
  // then
  expect(differs({ name: "Court 1", note: "clay" }, { name: "Court 1" })).toBe(true);
});

// A surface marks itself while it is still loading, and nothing is unsaved before anything is known.
it("given a side that has not loaded, when comparing, then nothing is unsaved", () => {
  // then
  expect(differs(undefined, { number: 1 })).toBe(false);
  expect(differs({ number: 1 }, undefined)).toBe(false);
});

// A role ticked and unticked again leaves a new list holding the old contents.
it("given a list rebuilt with the same entries, when comparing, then nothing is unsaved", () => {
  // then
  expect(differs({ roles: ["MEMBER", "TRAINER"] }, { roles: ["MEMBER", "TRAINER"] })).toBe(false);
});

it("given a list with an entry added, when comparing, then it is unsaved", () => {
  // then
  expect(differs({ roles: ["MEMBER"] }, { roles: ["MEMBER", "TRAINER"] })).toBe(true);
});
