import { describe, expect, it } from "vitest";
import { NotUtf8Error, readCsvColumn, readCsvHeader } from "./read-csv";

const csv = (content: string) => new File([content], "roster.csv", { type: "text/csv" });
const legacy = (content: string) =>
  new File([Uint8Array.from(content, (character) => character.charCodeAt(0))],
    "roster.csv", { type: "text/csv" });

describe("readCsvHeader", () => {
  it("given a csv file, when reading its header, then only the first line is returned", async () => {
    expect(await readCsvHeader(csv("Nr,Vorname\n1,Jane\n2,Mary\n"))).toEqual(["Nr", "Vorname"]);
  });

  it("given a byte order mark, when reading the header, then it is not part of the first column", async () => {
    expect(await readCsvHeader(csv("﻿Nr,Vorname\n1,Jane\n"))).toEqual(["Nr", "Vorname"]);
  });

  it("given semicolons, when reading the header, then they separate the columns", async () => {
    expect(await readCsvHeader(csv("Nr;Vorname;E-Mail\n1;Jane;jane.doe@example.org\n")))
      .toEqual(["Nr", "Vorname", "E-Mail"]);
  });

  it("given tabs, when reading the header, then they separate the columns", async () => {
    expect(await readCsvHeader(csv("Nr\tVorname\tE-Mail\n1\tJane\tjane.doe@example.org\n")))
      .toEqual(["Nr", "Vorname", "E-Mail"]);
  });

  it("given windows line endings, when reading the header, then no column keeps a carriage return", async () => {
    expect(await readCsvHeader(csv("Nr,Vorname\r\n1,Jane\r\n"))).toEqual(["Nr", "Vorname"]);
  });

  it("given padded headers, when reading them, then the padding is not part of the name", async () => {
    expect(await readCsvHeader(csv(" Nr , Vorname \n1,Jane\n"))).toEqual(["Nr", "Vorname"]);
  });

  it("given quoted cells, when reading the header, then no column keeps its quotes", async () => {
    expect(await readCsvHeader(csv('"Nr";"Vorname"\n"1";"Jane"\n'))).toEqual(["Nr", "Vorname"]);
  });

  it("given a quoted name holding the other separator, when reading the header, then it stays one column", async () => {
    expect(await readCsvHeader(csv('Nr,"Vorname;Nachname",E-Mail\n')))
      .toEqual(["Nr", "Vorname;Nachname", "E-Mail"]);
  });

  it("given a header ending on its separator, when reading it, then the empty column is not offered", async () => {
    expect(await readCsvHeader(csv("Nr;Vorname;\n1;Jane;\n"))).toEqual(["Nr", "Vorname"]);
  });

  it("given a file written in windows-1252, when that encoding is chosen, then its umlauts are not replaced", async () => {
    expect(await readCsvHeader(legacy("Nr;Straße\n1;Marketplace 9\n"), "windows-1252"))
      .toEqual(["Nr", "Straße"]);
  });

  it("given a file that is not UTF-8, when no other encoding is chosen, then it says so instead of guessing", async () => {
    // a guess that lands on the wrong 8-bit encoding offers column names nobody can recognise
    await expect(readCsvHeader(legacy("Nr;Straße\n1;Marketplace 9\n")))
      .rejects.toBeInstanceOf(NotUtf8Error);
  });

  it("given a file with no line break, when reading its header, then the whole content is the header", async () => {
    expect(await readCsvHeader(csv("Nr,Vorname"))).toEqual(["Nr", "Vorname"]);
  });

  it("given an empty file, when reading its header, then no column is offered", async () => {
    expect(await readCsvHeader(csv(""))).toEqual([]);
  });

  it("given a file whose first line is blank, when reading its header, then no column is offered", async () => {
    expect(await readCsvHeader(csv("\nNr,Vorname\n"))).toEqual([]);
  });

  it("given a very large file, when reading its header, then only its beginning is read", async () => {
    // given
    const file = csv(`Nr,Vorname\n${"1,Jane\n".repeat(200_000)}`);
    let sliced: [number, number] | undefined;
    const original = file.slice.bind(file);
    Object.defineProperty(file, "slice", {
      value: (start: number, end: number) => {
        sliced = [start, end];
        return original(start, end);
      }
    });

    // when
    const header = await readCsvHeader(file);

    // then
    expect(header).toEqual(["Nr", "Vorname"]);
    expect(sliced?.[1]).toBeLessThan(file.size);
  });

  it("given a multi byte character on the read boundary, when reading the header, then it is not mistaken for legacy bytes", async () => {
    // given
    const padding = "x".repeat(64 * 1024);
    const file = csv(`Nr,Vorname\n1,${padding}é\n`);

    // when / then
    expect(await readCsvHeader(file)).toEqual(["Nr", "Vorname"]);
  });
});

describe("readCsvColumn", () => {
  it("given a column of categories, when reading it, then every distinct value is offered once", async () => {
    expect(await readCsvColumn(csv("Nr,Kategorie\n1,Erwachsene\n2,Jugend\n3,Erwachsene\n"), "Kategorie"))
      .toEqual(["Erwachsene", "Jugend"]);
  });

  it("given blank cells in the column, when reading it, then they are not offered as a value", async () => {
    expect(await readCsvColumn(csv("Nr,Kategorie\n1,Erwachsene\n2,\n3, \n"), "Kategorie"))
      .toEqual(["Erwachsene"]);
  });

  it("given a header the file does not carry, when reading that column, then nothing is offered", async () => {
    expect(await readCsvColumn(csv("Nr,Kategorie\n1,Erwachsene\n"), "Sparte")).toEqual([]);
  });

  it("given rows shorter than the header, when reading a column, then they contribute no value", async () => {
    expect(await readCsvColumn(csv("Nr,Kategorie\n1\n2,Jugend\n"), "Kategorie")).toEqual(["Jugend"]);
  });

  it("given quoted cells, when reading a column, then its values are offered without quotes", async () => {
    expect(await readCsvColumn(csv('"Nr";"Typ"\n"1";"Benutzer"\n"2";"Administrator"\n'), "Typ"))
      .toEqual(["Benutzer", "Administrator"]);
  });

  it("given a value holding a line break, when reading a column, then the row after it is still read", async () => {
    expect(await readCsvColumn(csv('Nr,Kategorie,Ort\n1,"Jugend\nund Aktive",Foxhollow\n2,Aktive,Foxhollow\n'), "Kategorie"))
      .toEqual(["Jugend\nund Aktive", "Aktive"]);
  });

  it("given an empty column before the wanted one, when reading it, then the values do not shift", async () => {
    expect(await readCsvColumn(csv("Nr;;Kategorie\n1;;Aktive\n2;;Jugend\n"), "Kategorie"))
      .toEqual(["Aktive", "Jugend"]);
  });

  it("given a file written in windows-1252, when that encoding is chosen, then its values keep their umlauts", async () => {
    expect(await readCsvColumn(legacy("Nr;Status\n1;fördernd\n2;aktiv\n"), "Status", "windows-1252"))
      .toEqual(["fördernd", "aktiv"]);
  });
});
