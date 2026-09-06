package org.courtside.dataexchange.internal;

import org.courtside.dataexchange.CanonicalField;
import org.junit.jupiter.api.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class RosterCsvTest {

    private static final Charset WINDOWS_1252 = Charset.forName("windows-1252");
    private static final Map<String, CanonicalField> COLUMNS = Map.of(
            "memberNumber", CanonicalField.EXTERNAL_ID,
            "firstName", CanonicalField.FIRST_NAME,
            "lastName", CanonicalField.LAST_NAME,
            "email", CanonicalField.EMAIL,
            "membershipType", CanonicalField.MEMBERSHIP_TYPE);

    private static RosterCsv.Row jane() {
        return new RosterCsv.Row("10", "Jane", "Doe", "jane.doe@example.org", "Adult",
                LocalDate.of(2026, 1, 1), null);
    }

    @Test
    void givenRowsToWrite_whenTheFileIsWritten_thenItNamesTheColumnsTheImportUnderstands() {
        // when
        String written = new String(RosterCsv.write(List.of(jane()), ',', StandardCharsets.UTF_8),
                StandardCharsets.UTF_8);

        // then
        assertThat(written.lines().findFirst()).hasValue("﻿memberNumber,firstName,lastName,"
                + "email,membershipType,membershipStartedOn,membershipEndedOn");
        assertThat(written.lines().skip(1))
                .containsExactly("10,Jane,Doe,jane.doe@example.org,Adult,2026-01-01,");
    }

    @Test
    void givenUtf8_whenTheFileIsWritten_thenItOpensWithAByteOrderMarkAndWindows1252DoesNot() {
        // when
        byte[] utf8 = RosterCsv.write(List.of(jane()), ',', StandardCharsets.UTF_8);
        byte[] legacy = RosterCsv.write(List.of(jane()), ';', WINDOWS_1252);

        // then
        assertThat(utf8).startsWith((byte) 0xEF, (byte) 0xBB, (byte) 0xBF);
        assertThat(legacy).startsWith((byte) 'm');
    }

    @Test
    void givenANameWithAnUmlaut_whenWindows1252IsChosen_thenTheBytesCarryThatNameAndNotAQuestionMark() {
        // given
        RosterCsv.Row umlaut = new RosterCsv.Row("11", "Jörg", "Müller", "", "Adult", null, null);

        // when
        byte[] written = RosterCsv.write(List.of(umlaut), ';', WINDOWS_1252);

        // then
        assertThat(new String(written, WINDOWS_1252)).contains("Jörg;Müller");
        assertThat(new String(written, WINDOWS_1252)).doesNotContain("?");
    }

    @Test
    void givenCellsHoldingTheSeparatorAQuoteAndANewline_whenTheImportReadsItBack_thenEveryValueIsUnchanged() {
        // given
        RosterCsv.Row awkward = new RosterCsv.Row("12", "Mary \"Major\"", "Roe, the elder",
                "mary.major@example.org", "Youth\nand student", null, null);

        // when
        byte[] written = RosterCsv.write(List.of(jane(), awkward), ';', StandardCharsets.UTF_8);
        CsvSnapshot read = SnapshotParser.parse(written, COLUMNS, StandardCharsets.UTF_8, ';');

        // then
        assertThat(read.errors()).isEmpty();
        assertThat(read.rows()).extracting(CsvSnapshot.SnapshotRow::externalId)
                .containsExactly("10", "12");
        assertThat(read.rows().get(1).values())
                .containsEntry(CanonicalField.FIRST_NAME, "Mary \"Major\"")
                .containsEntry(CanonicalField.LAST_NAME, "Roe, the elder")
                .containsEntry(CanonicalField.MEMBERSHIP_TYPE, "Youth\nand student");
    }

    @Test
    void givenAPersonWithoutAnAddressOrAMembership_whenTheRowIsWritten_thenTheCellsAreEmpty() {
        // given
        RosterCsv.Row sparse = new RosterCsv.Row("13", "Richard", "Miles", null, null, null, null);

        // when
        String written = new String(RosterCsv.write(List.of(sparse), ',', StandardCharsets.UTF_8),
                StandardCharsets.UTF_8);

        // then
        assertThat(written.lines().skip(1)).containsExactly("13,Richard,Miles,,,,");
    }
}
