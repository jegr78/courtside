import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ImportSource, type ImportSourceRequest, type MembershipType } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedCount } from "../../test/UnsavedCount";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { ImportSourceForm } from "./ImportSourceForm";

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: null, active: true, grantsAccount: false };
const passive: MembershipType = { id: "type-2", name: "Passive", ruleSetId: null, active: true, grantsAccount: false };
const retired: MembershipType = { id: "type-3", name: "Youth", ruleSetId: null, active: false, grantsAccount: false };
const dormant: MembershipType = { id: "type-4", name: "Students", ruleSetId: null, active: false, grantsAccount: false };

const existing: ImportSource = {
  id: "source-1",
  sourceKey: "roster-system",
  displayName: "Membership system", separator: ";", encoding: "UTF-8",
  columns: { "Member number": "EXTERNAL_ID", "First name": "FIRST_NAME", "Last name": "LAST_NAME" },
  membershipTypes: {},
  defaultMembershipTypeId: "type-1",
  ownedFields: [],
  removalWarningPercent: 10, columnMode: "HEADER", positions: [], columnCount: null
};

function file(content: string, name = "members.csv") {
  return new File([content], name, { type: "text/csv" });
}

function show(source: ImportSource | undefined, save: (request: ImportSourceRequest) => Promise<unknown>,
              types: MembershipType[] = [adults, passive]) {
  render(<UnsavedChangesProvider>
    <UnsavedCount />
    <ImportSourceForm source={source} types={types} disabled={false} save={save} />
  </UnsavedChangesProvider>);
}

describe("ImportSourceForm", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("given a type nobody offers any more, when the default is chosen, then it is not on the list", () => {
    // given / when
    show(undefined, vi.fn(), [adults, passive, retired]);

    // then
    expect([...screen.getByTestId("source-default-type").querySelectorAll("option")]
      .map((option) => option.value)).toEqual(["", "type-1", "type-2"]);
  });

  it("given the source already names a retired type, when the form opens, then it stays and says so", () => {
    // given / when — withholding it would clear the club's own choice on the next save
    show({ ...existing, defaultMembershipTypeId: "type-3" }, vi.fn(), [adults, passive, retired]);

    // then
    const chosen = screen.getByTestId("source-default-type").querySelector("option[value='type-3']");
    expect(chosen).toHaveTextContent("Youth (no longer offered)");
  });

  it("given a category assigned a retired type, when the source is read, then that select holds it and no other retired one", () => {
    // given / when — the mapping select carries the same trap as the default one
    show({
      ...existing,
      columns: { ...existing.columns, Category: "MEMBERSHIP_TYPE" },
      membershipTypes: { Youth: "type-3" }
    }, vi.fn(), [adults, passive, retired, dormant]);

    // then
    const select = screen.getByTestId("category-Youth");
    expect([...select.querySelectorAll("option")].map((option) => option.value))
      .toEqual(["", "type-1", "type-2", "type-3"]);
    expect(select.querySelector("option[value='type-3']")).toHaveTextContent("Youth (no longer offered)");
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
    const fetching = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    show(undefined, vi.fn());

    // when
    await userEvent.upload(screen.getByTestId("source-file"),
      file("Number;Status\n1;active\n"));
    await screen.findByTestId("column-EXTERNAL_ID");

    // then — the readable character sets are asked for, the member list is not sent anywhere
    expect(fetching.mock.calls.map(([path]) => path)).toEqual(["/api/admin/import/encodings"]);
    expect(fetching.mock.calls.every(([, init]) => init?.body === undefined)).toBe(true);
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

  it("given a source that stores a separator, when a file is chosen, then the stored one survives", async () => {
    // given — a separator this product would never have guessed at, confirmed once by the club
    show({ ...existing, separator: "|" }, vi.fn());

    // when — counting columns would suggest a comma for this file and be wrong
    await userEvent.upload(screen.getByTestId("source-file"),
      new File(["Nr|Vorname\n1|Jane\n"], "members.csv", { type: "text/csv" }));

    // then — a guess must not quietly replace an answer the club already gave
    expect(screen.getByTestId("source-separator")).toHaveValue("|");
    expect([...(await screen.findByTestId("column-EXTERNAL_ID")).querySelectorAll("option")]
      .map((option) => option.getAttribute("value"))).toContain("Nr");
  });

  it("given a described source, when it is saved, then how to read it travels with it", async () => {
    // given
    const save = vi.fn().mockResolvedValue(undefined);
    show(existing, save);
    await userEvent.type(screen.getByTestId("source-name"), " export");

    // when
    await userEvent.click(screen.getByTestId("save-source"));

    // then
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ separator: ";", encoding: "UTF-8" }));
  });

  it("given a source that stores a character set, when a file in it is chosen, then nothing is asked", async () => {
    // given — the club's export tool has written windows-1252 since before this source existed
    show({ ...existing, encoding: "windows-1252", separator: ";" }, vi.fn());
    expect(screen.getByTestId("source-encoding")).toHaveValue("windows-1252");

    // when — "Nr;Straße" as windows-1252, which strict UTF-8 cannot decode
    await userEvent.upload(screen.getByTestId("source-file"),
      new File([Uint8Array.from([78, 114, 59, 83, 116, 114, 97, 223, 101, 10, 49, 59, 88, 10])],
        "members.csv", { type: "text/csv" }));

    // then — a question already answered once is not asked again
    expect([...(await screen.findByTestId("column-EXTERNAL_ID")).querySelectorAll("option")]
      .map((option) => option.getAttribute("value"))).toContain("Straße");
    expect(screen.queryByTestId("source-not-utf8")).not.toBeInTheDocument();
  });

  it("given a character set the browser cannot read, when it is chosen, then the form says so and the import stays possible", async () => {
    // given
    show(undefined, vi.fn());
    await userEvent.upload(screen.getByTestId("source-file"),
      new File([Uint8Array.from([78, 114, 59, 83, 116, 114, 97, 223, 101, 10])],
        "members.csv", { type: "text/csv" }));
    await screen.findByTestId("source-encoding");

    // when — the instance can decode this one, the browser cannot
    await userEvent.clear(screen.getByTestId("source-encoding"));
    await userEvent.type(screen.getByTestId("source-encoding"), "IBM930");

    // then — an empty column list with no explanation is what this refuses to be
    expect(await screen.findByTestId("source-encoding-unreadable")).toBeInTheDocument();
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

describe("ImportSourceForm by position", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  const positional: ImportSource = {
    ...existing, columns: {}, columnMode: "POSITION", columnCount: 4,
    positions: [{ position: 1, field: "EXTERNAL_ID" }, { position: 2, field: "FIRST_NAME" }, { position: 3, field: "LAST_NAME" }]
  };

  it("given a headerless export, when the source is described by position, then numbered columns are shown and the positions are sent", async () => {
    // given
    const save = vi.fn().mockResolvedValue(existing);
    show(undefined, save);
    await userEvent.click(screen.getByTestId("column-mode-POSITION"));

    // when
    await userEvent.upload(screen.getByTestId("source-file"), file("4711;Jane;Doe;A\n4712;John;Roe;B\n"));
    expect(await screen.findByTestId("column-sample")).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("source-key"), "headerless-system");
    await userEvent.type(screen.getByTestId("source-name"), "Headerless system");
    await userEvent.selectOptions(screen.getByTestId("position-LAST_NAME"), "3");
    await userEvent.selectOptions(screen.getByTestId("position-EXTERNAL_ID"), "1");
    await userEvent.selectOptions(screen.getByTestId("position-FIRST_NAME"), "2");
    await userEvent.selectOptions(screen.getByTestId("source-default-type"), "type-1");
    await userEvent.click(screen.getByTestId("save-source"));

    // then
    expect(screen.getByTestId("sample-column-4")).toHaveTextContent("4");
    expect(screen.getByTestId("source-column-count")).toHaveValue(4);
    expect(screen.queryByTestId("sample-header-row")).not.toBeInTheDocument();
    const request = save.mock.calls[0][0] as ImportSourceRequest;
    expect(request).toEqual(expect.objectContaining({
      columnMode: "POSITION", columnCount: 4,
      positions: [{ position: 1, field: "EXTERNAL_ID" }, { position: 2, field: "FIRST_NAME" }, { position: 3, field: "LAST_NAME" }]
    }));
    expect(request.columns).toBeUndefined();
  });

  it("given an export whose first row looks like a header, when read by position, then that row is marked", async () => {
    // given
    show(undefined, vi.fn());
    await userEvent.click(screen.getByTestId("column-mode-POSITION"));

    // when
    await userEvent.upload(screen.getByTestId("source-file"), file("Number;Given;Family\n4711;Jane;Doe\n"));

    // then
    expect(await screen.findByTestId("sample-header-row")).toBeInTheDocument();
    expect(screen.getByTestId("sample-row-1")).toHaveAttribute("data-header-like", "true");
    expect(screen.getByTestId("sample-row-2")).not.toHaveAttribute("data-header-like");
  });

  it("given a character set the browser cannot read, when read by position, then the column count is asked for by hand", async () => {
    // given
    show(undefined, vi.fn());
    await userEvent.click(screen.getByTestId("column-mode-POSITION"));
    await userEvent.upload(screen.getByTestId("source-file"),
      new File([Uint8Array.from([52, 55, 59, 83, 116, 114, 97, 223, 101, 10])], "members.csv", { type: "text/csv" }));
    await userEvent.clear(screen.getByTestId("source-encoding"));

    // when
    await userEvent.type(screen.getByTestId("source-encoding"), "IBM930");

    // then
    expect(await screen.findByTestId("column-count-by-hand")).toBeInTheDocument();
    expect(screen.queryByTestId("column-sample")).not.toBeInTheDocument();
    await userEvent.clear(screen.getByTestId("source-column-count"));
    await userEvent.type(screen.getByTestId("source-column-count"), "6");
    expect(screen.getByTestId("position-EXTERNAL_ID").querySelectorAll("option")).toHaveLength(7);
  });

  it("given a source stored by position, when it opens untouched, then its positions show and nothing is unsaved", async () => {
    // when
    show(positional, vi.fn());

    // then
    expect(await screen.findByTestId("position-LAST_NAME")).toHaveValue("3");
    expect(screen.getByTestId("column-mode-POSITION")).toBeChecked();
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");
  });

  it("given a source stored by header, when it is switched to positions, then saving asks first and only the confirmation sends it", async () => {
    // given
    const save = vi.fn().mockResolvedValue(existing);
    show(existing, save);
    await userEvent.click(screen.getByTestId("column-mode-POSITION"));
    await userEvent.type(screen.getByTestId("source-column-count"), "3");
    await userEvent.selectOptions(screen.getByTestId("position-EXTERNAL_ID"), "1");
    await userEvent.selectOptions(screen.getByTestId("position-FIRST_NAME"), "2");
    await userEvent.selectOptions(screen.getByTestId("position-LAST_NAME"), "3");

    // when
    await userEvent.click(screen.getByTestId("save-source"));

    // then
    expect(screen.getByTestId("column-mode-confirmation")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("confirm-column-mode-change"));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ columnMode: "POSITION", confirmColumnModeChange: true }));
  });

  it("given a pending switch, when it is cancelled, then nothing is sent", async () => {
    // given
    const save = vi.fn();
    show(existing, save);
    await userEvent.click(screen.getByTestId("column-mode-POSITION"));
    await userEvent.click(screen.getByTestId("save-source"));

    // when
    await userEvent.click(screen.getByTestId("cancel-column-mode-change"));

    // then
    expect(screen.queryByTestId("column-mode-confirmation")).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});

it("given a described source, when nothing is touched, then it holds nothing to lose", async () => {
  // when
  show(existing, () => Promise.resolve());

  // then
  expect(await screen.findByTestId("source-key")).toBeInTheDocument();
  expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");
  expect(screen.queryByTestId("unsaved-mark-import-source:source-1")).not.toBeInTheDocument();
});

it("given a described source, when its name is edited and typed back, then nothing is left to lose", async () => {
  // given
  show(existing, () => Promise.resolve());
  const name = await screen.findByTestId("source-name");

  // when
  await userEvent.type(name, "!");

  // then
  expect(await screen.findByTestId("unsaved-mark-import-source:source-1")).toBeInTheDocument();
  expect(screen.getByTestId("save-source"))
    .toHaveAttribute("aria-describedby", "unsaved-mark-import-source:source-1");

  // when
  await userEvent.clear(name);
  await userEvent.type(name, "Membership system");

  // then
  await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
});

it("given a described source, when an edit is discarded, then the stored description returns and nothing is left to lose", async () => {
  // given
  show(existing, () => Promise.resolve());
  await userEvent.type(await screen.findByTestId("source-name"), "!");
  await userEvent.click(screen.getByTestId("owned-FIRST_NAME"));
  expect(screen.getByTestId("unsaved-mark-import-source:source-1")).toHaveTextContent("Not saved yet: Membership system");

  // when
  await userEvent.click(screen.getByTestId("discard-import-source:source-1"));

  // then
  expect(screen.getByTestId("source-name")).toHaveValue("Membership system");
  expect(screen.getByTestId("owned-FIRST_NAME")).not.toBeChecked();
  await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
});

// The column mapping is a record inside the request, and rebuilding it reorders its keys.
it("given an owned field ticked and unticked again, when the source is read, then nothing is left to lose", async () => {
  // given
  show(existing, () => Promise.resolve());
  const owned = await screen.findByTestId("owned-FIRST_NAME");

  // when
  await userEvent.click(owned);

  // then
  await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

  // when
  await userEvent.click(screen.getByTestId("owned-LAST_NAME"));
  await userEvent.click(screen.getByTestId("owned-LAST_NAME"));
  await userEvent.click(owned);

  // then
  await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
});

// A category the server left unassigned is absent from the request, so it must be absent from the
// comparison as well or the source reads as unsaved with nothing to save.
it("given a category the server left unassigned, when the source is read, then it holds nothing to lose", async () => {
  // given
  show({
    ...existing,
    columns: { ...existing.columns, Category: "MEMBERSHIP_TYPE" },
    membershipTypes: { Adults: "type-1", Passive: "" }
  }, () => Promise.resolve());

  // then
  expect(await screen.findByTestId("source-key")).toBeInTheDocument();
  expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");

  // and the unassigned one is still a row somebody can assign, rather than one the form hides
  expect(screen.getByTestId("category-Passive")).toHaveValue("");
});

it("given a column a club named __proto__, when it is mapped, then it stays a column of its own", async () => {
  // given
  const save = vi.fn((request: ImportSourceRequest) => Promise.resolve(request));
  // Parsed rather than written out, because a literal would set the prototype instead of a key —
  // which is the very confusion this guards against.
  const columns = JSON.parse('{"__proto__":"EXTERNAL_ID"}') as ImportSource["columns"];
  show({ ...existing, columns }, save);
  await userEvent.type(await screen.findByTestId("source-name"), " export");

  // when
  await userEvent.click(screen.getByTestId("save-source"));

  // then
  expect(Object.keys(save.mock.calls[0][0].columns ?? {})).toContain("__proto__");
});
