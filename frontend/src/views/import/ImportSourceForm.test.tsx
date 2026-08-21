import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ImportSource, type ImportSourceRequest, type MembershipType } from "../../api/client";
import i18n from "../../i18n";
import { ImportSourceForm } from "./ImportSourceForm";

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: null, active: true };
const passive: MembershipType = { id: "type-2", name: "Passive", ruleSetId: null, active: true };

const existing: ImportSource = {
  id: "source-1",
  sourceKey: "roster-system",
  displayName: "Membership system", separator: ";",
  columns: { "Member number": "EXTERNAL_ID", "First name": "FIRST_NAME", "Last name": "LAST_NAME" },
  membershipTypes: {},
  defaultMembershipTypeId: "type-1",
  ownedFields: [],
  removalWarningPercent: 10
};

function file(content: string, name = "members.csv") {
  return new File([content], name, { type: "text/csv" });
}

function show(source: ImportSource | undefined, save: (request: ImportSourceRequest) => Promise<unknown>) {
  render(<ImportSourceForm source={source} types={[adults, passive]} disabled={false} save={save} />);
}

describe("ImportSourceForm", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("given a chosen file, when it is read, then its headers become the columns to map", async () => {
    // given
    show(undefined, vi.fn());

    // when
    await userEvent.upload(screen.getByTestId("source-file"),
      file("Member number;First name;Last name;Status\n4711;Jane;Doe;active\n"));

    // then
    const externalId = await screen.findByTestId("column-EXTERNAL_ID");
    expect([...externalId.querySelectorAll("option")].map((option) => option.value))
      .toEqual(["", "Member number", "First name", "Last name", "Status"]);
  });

  it("given a category column, when it is mapped, then the values in that column can be assigned", async () => {
    // given
    show(undefined, vi.fn());
    await userEvent.upload(screen.getByTestId("source-file"),
      file("Number;Status\n1;active\n2;passive\n3;active\n"));
    await screen.findByTestId("column-MEMBERSHIP_TYPE");

    // when
    await userEvent.selectOptions(screen.getByTestId("column-MEMBERSHIP_TYPE"), "Status");

    // then
    expect(await screen.findByTestId("category-active")).toBeInTheDocument();
    expect(screen.getByTestId("category-passive")).toBeInTheDocument();
  });

  it("given a file that never leaves the browser, when it is read, then nothing is uploaded", async () => {
    // given
    const fetching = vi.spyOn(globalThis, "fetch");
    show(undefined, vi.fn());

    // when
    await userEvent.upload(screen.getByTestId("source-file"),
      file("Number;Status\n1;active\n"));
    await screen.findByTestId("column-EXTERNAL_ID");

    // then
    expect(fetching).not.toHaveBeenCalled();
  });

  it("given every required column, when the source is saved, then the mapping is sent as written", async () => {
    // given
    const save = vi.fn().mockResolvedValue(existing);
    show(undefined, save);
    await userEvent.upload(screen.getByTestId("source-file"),
      file("Number;Given;Family;Status\n1;Jane;Doe;active\n"));
    await screen.findByTestId("column-EXTERNAL_ID");

    // when
    await userEvent.type(screen.getByTestId("source-key"), "roster-system");
    await userEvent.type(screen.getByTestId("source-name"), "Membership system");
    await userEvent.selectOptions(screen.getByTestId("column-EXTERNAL_ID"), "Number");
    await userEvent.selectOptions(screen.getByTestId("column-FIRST_NAME"), "Given");
    await userEvent.selectOptions(screen.getByTestId("column-LAST_NAME"), "Family");
    await userEvent.selectOptions(screen.getByTestId("source-default-type"), "type-1");
    await userEvent.click(screen.getByTestId("save-source"));

    // then
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      sourceKey: "roster-system",
      displayName: "Membership system",
      columns: { Number: "EXTERNAL_ID", Given: "FIRST_NAME", Family: "LAST_NAME" },
      defaultMembershipTypeId: "type-1"
    }));
  });

  it("given an existing source, when it is opened without a file, then its stored mapping is still shown", async () => {
    // given / when
    show(existing, vi.fn());

    // then
    expect(await screen.findByTestId("source-key")).toHaveValue("roster-system");
    expect(screen.getByTestId("column-EXTERNAL_ID")).toHaveValue("Member number");
    expect(screen.getByTestId("column-FIRST_NAME")).toHaveValue("First name");
  });

  it("given an existing source, when a category value is assigned, then it is sent with the rest", async () => {
    // given
    const save = vi.fn().mockResolvedValue(existing);
    show(existing, save);
    await userEvent.upload(screen.getByTestId("source-file"),
      file("Member number;First name;Last name;Status\n1;Jane;Doe;passive\n"));
    await screen.findByTestId("column-MEMBERSHIP_TYPE");
    await userEvent.selectOptions(screen.getByTestId("column-MEMBERSHIP_TYPE"), "Status");
    await screen.findByTestId("category-passive");

    // when
    await userEvent.selectOptions(screen.getByTestId("category-passive"), "type-2");
    await userEvent.click(screen.getByTestId("save-source"));

    // then
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      membershipTypes: { passive: "type-2" }
    }));
  });

  it("given the identifying column, when choosing which fields the source owns, then it cannot be owned", () => {
    // given / when
    show(existing, vi.fn());

    // then
    expect(screen.queryByTestId("owned-EXTERNAL_ID")).not.toBeInTheDocument();
    expect(screen.getByTestId("owned-FIRST_NAME")).toBeInTheDocument();
    expect(screen.getByTestId("owned-EMAIL")).toBeInTheDocument();
  });

  it("given a file whose header the source does not map, when it is read, then the unmapped columns are named", async () => {
    // given
    show(existing, vi.fn());

    // when
    await userEvent.upload(screen.getByTestId("source-file"),
      file("Member number;First name;Last name;IBAN;Phone\n1;Jane;Doe;XX00;0\n"));

    // then
    const unmapped = await screen.findByTestId("unmapped-columns");
    expect(unmapped).toHaveTextContent("IBAN");
    expect(unmapped).toHaveTextContent("Phone");
  });

  it("given a chosen file, when its separator is suggested, then the club can correct it and the columns follow", async () => {
    // given
    show(undefined, vi.fn());
    await userEvent.upload(screen.getByTestId("source-file"),
      new File(["Nr|Vorname\n1|Jane\n"], "members.csv", { type: "text/csv" }));

    // then — counting columns suggests a comma here, which is wrong, and the club says so
    expect(screen.getByTestId("source-separator")).toHaveValue(",");

    // when
    await userEvent.clear(screen.getByTestId("source-separator"));
    await userEvent.type(screen.getByTestId("source-separator"), "|");

    // then — a character this product would never have guessed at reads the file correctly
    expect([...screen.getByTestId("column-EXTERNAL_ID").querySelectorAll("option")]
      .map((option) => option.getAttribute("value"))).toContain("Nr");
  });

  it("given a described source, when it is saved, then the separator travels with it", async () => {
    // given
    const save = vi.fn().mockResolvedValue(undefined);
    show(existing, save);

    // when
    await userEvent.click(screen.getByTestId("save-source"));

    // then
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ separator: ";" }));
  });

  it("given an export that is not UTF-8, when it is chosen, then its columns are offered rather than refused", async () => {
    // given / when — "Nr;Straße" as windows-1252, which strict UTF-8 cannot decode
    show(undefined, vi.fn());
    await userEvent.upload(screen.getByTestId("source-file"),
      new File([Uint8Array.from([78, 114, 59, 83, 116, 114, 97, 223, 101, 10, 49, 59, 88, 10])],
        "members.csv", { type: "text/csv" }));

    // then — the club's own export is the reference, so it has to arrive readable
    expect(await screen.findByTestId("source-not-utf8")).toBeInTheDocument();
    expect(screen.getByTestId("source-encoding")).toHaveValue("windows-1252");
    expect([...screen.getByTestId("column-EXTERNAL_ID").querySelectorAll("option")]
      .map((option) => option.getAttribute("value"))).toContain("Straße");
  });
});
