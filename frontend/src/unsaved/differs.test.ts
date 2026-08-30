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

// A column mapping is a record of its own, and rebuilding it puts the keys back in another order.
it("given a nested record with the same entries, when comparing, then nothing is unsaved", () => {
  // then
  expect(differs(
    { columns: { Surname: "LAST_NAME", Forename: "FIRST_NAME" } },
    { columns: { Forename: "FIRST_NAME", Surname: "LAST_NAME" } })).toBe(false);
});

it("given a nested record with one entry changed, when comparing, then it is unsaved", () => {
  // then
  expect(differs(
    { columns: { Surname: "LAST_NAME" } },
    { columns: { Surname: "EXTERNAL_ID" } })).toBe(true);
});

it("given a nested record with an entry added, when comparing, then it is unsaved", () => {
  // then
  expect(differs({ columns: { Surname: "LAST_NAME" } }, { columns: {} })).toBe(true);
});

// The comparison looks into plain objects only, so anything else stands or falls by identity
// rather than by having no fields of its own to tell two of them apart.
it("given two objects that are not plain, when comparing them, then they count as unsaved", () => {
  // then
  expect(differs({ read: new Date(0) }, { read: new Date(0) })).toBe(true);
});
