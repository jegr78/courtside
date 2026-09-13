import { describe, expect, it } from "vitest";
import { declaredWorkflows, walkedJourneys } from "./journey-catalogue";

// Its two operations are the build identifier and the web manifest, which no club performs as a
// task, so there is nothing for a person to be walked through.
const NO_CLUB_PERFORMS_THIS = "build-and-source-discovery";

describe("the journey catalogue", () => {
  it("given every journey, when it is listed, then each one declares the workflow it walks", () => {
    // when
    const undeclared = walkedJourneys().filter((journey) => journey.workflows.length !== 1);

    // then
    expect(undeclared.map((journey) => journey.file)).toEqual([]);
  });

  it("given the production workflows, when the declarations are read, then every one is walked", () => {
    // given
    const walked = new Set(walkedJourneys().flatMap((journey) => journey.workflows));

    // when
    const unwalked = declaredWorkflows().filter((workflow) => workflow !== NO_CLUB_PERFORMS_THIS && !walked.has(workflow));

    // then
    expect(unwalked).toEqual([]);
  });

  it("given the declarations, when they are read, then none names a workflow the inventory does not", () => {
    // given
    const known = new Set(declaredWorkflows());

    // when
    const unknown = walkedJourneys().flatMap((journey) => journey.workflows).filter((workflow) => !known.has(workflow));

    // then
    expect(unknown).toEqual([]);
  });
});
