package org.courtside.dataexchange;

import org.courtside.dataexchange.internal.CsvSnapshot;
import org.courtside.dataexchange.internal.MemberNumber;
import org.courtside.dataexchange.internal.SnapshotHeaderInvalidException;
import org.courtside.dataexchange.internal.SnapshotParser;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SnapshotParserTest {

    private static final Map<String, CanonicalField> COLUMNS = columns();

    @Test
    void givenAFileWrittenWithAByteOrderMark_whenParsing_thenTheFirstHeaderIsStillRecognised() {
        // given
        String content = "﻿Member number,First name,Last name,Email\n4711,Jane,Doe,jane.doe@example.org\n";

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.errors()).isEmpty();
        assertThat(snapshot.rows()).singleElement()
                .satisfies(row -> assertThat(row.externalId()).isEqualTo("4711"));
    }

    @Test
    void givenQuotedCellsHoldingACommaAndANewline_whenParsing_thenBothArriveWhole() {
        // given
        String content = """
                Member number,First name,Last name,Email
                4711,"Jane, the elder","Doe
                Roe",jane.doe@example.org
                """;

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.errors()).isEmpty();
        assertThat(snapshot.rows()).singleElement().satisfies(row -> {
            assertThat(row.values()).containsEntry(CanonicalField.FIRST_NAME, "Jane, the elder");
            assertThat(row.values()).containsEntry(CanonicalField.LAST_NAME, "Doe\nRoe");
        });
    }

    @Test
    void givenAColumnTheMappingDoesNotName_whenParsing_thenItIsReportedRatherThanSilentlyDropped() {
        // given
        String content = "Member number,First name,Last name,Email,IBAN\n4711,Jane,Doe,jane.doe@example.org,XX00\n";

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.ignoredColumns()).containsExactly("IBAN");
        assertThat(snapshot.rows()).singleElement()
                .satisfies(row -> assertThat(row.values())
                        .containsOnlyKeys(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME,
                                CanonicalField.EMAIL));
    }

    @Test
    void givenAHeaderWithoutARequiredField_whenParsing_thenTheWholeFileIsRefused() {
        // given
        String content = "Member number,First name\n4711,Jane\n";

        // when / then
        assertThatThrownBy(() -> parse(content))
                .isInstanceOf(SnapshotHeaderInvalidException.class)
                .extracting("code").isEqualTo("import.snapshot.header.missingField");
    }

    @Test
    void givenAHeaderNamingTheSameColumnTwice_whenParsing_thenTheWholeFileIsRefused() {
        // given
        String content = "Member number,First name,Last name,Email,First name\n4711,Jane,Doe,jane.doe@example.org,Jane\n";

        // when / then
        assertThatThrownBy(() -> parse(content))
                .isInstanceOf(SnapshotHeaderInvalidException.class)
                .extracting("code").isEqualTo("import.snapshot.header.duplicateColumn");
    }

    @Test
    void givenAnEmptyFile_whenParsing_thenTheWholeFileIsRefused() {
        // when / then
        assertThatThrownBy(() -> parse(""))
                .isInstanceOf(SnapshotHeaderInvalidException.class)
                .extracting("code").isEqualTo("import.snapshot.header.missing");
    }

    @Test
    void givenARowWithFewerCellsThanTheHeader_whenParsing_thenOnlyThatRowFails() {
        // given
        String content = """
                Member number,First name,Last name,Email
                4711,Jane
                4712,John,Roe,john.roe@example.org
                """;

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.errors()).singleElement().satisfies(error -> {
            assertThat(error.rowNumber()).isEqualTo(1);
            assertThat(error.code()).isEqualTo("import.snapshot.row.cellsMissing");
        });
        assertThat(snapshot.rows()).singleElement()
                .satisfies(row -> assertThat(row.externalId()).isEqualTo("4712"));
    }

    @Test
    void givenTheSameMemberNumberTwiceInOneFile_whenParsing_thenTheSecondRowFails() {
        // given
        String content = """
                Member number,First name,Last name,Email
                4711,Jane,Doe,jane.doe@example.org
                4711,John,Roe,john.roe@example.org
                """;

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.errors()).singleElement().satisfies(error -> {
            assertThat(error.rowNumber()).isEqualTo(2);
            assertThat(error.code()).isEqualTo("import.snapshot.row.duplicateExternalId");
            assertThat(error.params()).containsEntry("externalId", "4711");
        });
        assertThat(snapshot.rows()).singleElement()
                .satisfies(row -> assertThat(row.values())
                        .containsEntry(CanonicalField.FIRST_NAME, "Jane"));
    }

    @Test
    void givenARowWithoutAMemberNumber_whenParsing_thenOnlyThatRowFails() {
        // given
        String content = """
                Member number,First name,Last name,Email
                   ,Jane,Doe,jane.doe@example.org
                4712,John,Roe,john.roe@example.org
                """;

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.errors()).singleElement()
                .satisfies(error -> assertThat(error.code())
                        .isEqualTo("import.snapshot.row.externalIdUnusable"));
        assertThat(snapshot.rows()).hasSize(1);
    }

    @Test
    void givenAMemberNumberLongerThanTheReferenceHolds_whenParsing_thenOnlyThatRowFails() {
        // given
        String content = """
                Member number,First name,Last name,Email
                %s,Jane,Doe,jane.doe@example.org
                4712,John,Roe,john.roe@example.org
                """.formatted("4".repeat(MemberNumber.MAX_LENGTH + 1));

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.errors()).singleElement()
                .satisfies(error -> assertThat(error.code())
                        .isEqualTo("import.snapshot.row.externalIdUnusable"));
        assertThat(snapshot.rows()).singleElement()
                .satisfies(row -> assertThat(row.externalId()).isEqualTo("4712"));
    }

    @Test
    void whenParsing_thenEveryValueArrivesWithoutItsSurroundingWhitespace() {
        // given
        String content = "Member number,First name,Last name,Email\n  4711 , Jane , Doe , jane.doe@example.org \n";

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.rows()).singleElement().satisfies(row -> {
            assertThat(row.externalId()).isEqualTo("4711");
            assertThat(row.values()).containsEntry(CanonicalField.FIRST_NAME, "Jane");
            assertThat(row.values()).containsEntry(CanonicalField.LAST_NAME, "Doe");
        });
    }

    @Test
    void givenAFileWrittenInWindows1252_whenParsing_thenItsUmlautsArriveIntact() {
        // given
        byte[] windows1252 = "Member number,First name,Last name,Email\n4711,Janè,Doe,jane.doe@example.org\n"
                .getBytes(Charset.forName("windows-1252"));

        // when
        CsvSnapshot snapshot = SnapshotParser.parse(windows1252, COLUMNS);

        // then
        assertThat(snapshot.errors()).isEmpty();
        assertThat(snapshot.rows()).singleElement()
                .satisfies(row -> assertThat(row.values())
                        .containsEntry(CanonicalField.FIRST_NAME, "Janè"));
    }

    @Test
    void givenAFileWrittenInUtf16WithAByteOrderMark_whenParsing_thenItIsReadRatherThanMangled() {
        // given
        byte[] utf16 = "Member number,First name,Last name,Email\n4711,Jane,Doe,jane.doe@example.org\n"
                .getBytes(StandardCharsets.UTF_16LE);
        byte[] withMark = new byte[utf16.length + 2];
        withMark[0] = (byte) 0xFF;
        withMark[1] = (byte) 0xFE;
        System.arraycopy(utf16, 0, withMark, 2, utf16.length);

        // when
        CsvSnapshot snapshot = SnapshotParser.parse(withMark, COLUMNS);

        // then
        assertThat(snapshot.errors()).isEmpty();
        assertThat(snapshot.rows()).singleElement()
                .satisfies(row -> assertThat(row.externalId()).isEqualTo("4711"));
    }

    @Test
    void givenASemicolonSeparatedFile_whenParsing_thenTheSeparatorIsTakenFromTheHeader() {
        // given
        String content = "Member number;First name;Last name;Email\n4711;Jane;Doe;jane.doe@example.org\n";

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.errors()).isEmpty();
        assertThat(snapshot.rows()).singleElement()
                .satisfies(row -> assertThat(row.values())
                        .containsEntry(CanonicalField.FIRST_NAME, "Jane"));
    }

    @Test
    void givenACommaSeparatedFileWhoseCellsHoldSemicolons_whenParsing_thenTheCommaStillSeparates() {
        // given
        String content = """
                Member number,First name,Last name,Email
                4711,"Jane;the elder","Doe;Roe",jane.doe@example.org
                """;

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.errors()).isEmpty();
        assertThat(snapshot.rows()).singleElement().satisfies(row -> {
            assertThat(row.values()).containsEntry(CanonicalField.FIRST_NAME, "Jane;the elder");
            assertThat(row.values()).containsEntry(CanonicalField.LAST_NAME, "Doe;Roe");
        });
    }

    @Test
    void givenAHeaderEndingOnItsSeparator_whenParsing_thenTheEmptyTrailingColumnIsNotReportedAsIgnored() {
        // given
        String content = "Member number;First name;Last name;Email;\n4711;Jane;Doe;jane.doe@example.org;\n";

        // when
        CsvSnapshot snapshot = parse(content);

        // then
        assertThat(snapshot.errors()).isEmpty();
        assertThat(snapshot.ignoredColumns()).isEmpty();
        assertThat(snapshot.rows()).singleElement()
                .satisfies(row -> assertThat(row.values())
                        .containsEntry(CanonicalField.EMAIL, "jane.doe@example.org"));
    }

    @Test
    void givenTheExportOfAClubBookingSystem_whenParsing_thenEveryRowArrivesWithoutItsQuotes() {
        // given
        Map<String, CanonicalField> columns = new LinkedHashMap<>();
        columns.put("Benutzerkonto - Benutzername", CanonicalField.EXTERNAL_ID);
        columns.put("Person - Vorname", CanonicalField.FIRST_NAME);
        columns.put("Person - Nachname", CanonicalField.LAST_NAME);
        columns.put("Kontakt - E-Mail", CanonicalField.EMAIL);
        columns.put("Benutzerkonto - Typ", CanonicalField.MEMBERSHIP_TYPE);

        // when
        CsvSnapshot snapshot = SnapshotParser.parse(fixture("quoted-semicolon-export.csv"), columns);

        // then
        assertThat(snapshot.errors()).isEmpty();
        assertThat(snapshot.rows()).hasSize(4).first().satisfies(row -> {
            assertThat(row.externalId()).isEqualTo("doejane");
            assertThat(row.values()).containsEntry(CanonicalField.FIRST_NAME, "Jane");
            assertThat(row.values()).containsEntry(CanonicalField.MEMBERSHIP_TYPE, "Benutzer");
        });
    }

    @Test
    void givenTheExportOfAClubAdministrationSystem_whenParsing_thenItsWindows1252ColumnIsNamedIntact() {
        // given
        Map<String, CanonicalField> columns = new LinkedHashMap<>();
        columns.put("ID", CanonicalField.EXTERNAL_ID);
        columns.put("Vorname", CanonicalField.FIRST_NAME);
        columns.put("Nachname", CanonicalField.LAST_NAME);
        columns.put("EMail Privat", CanonicalField.EMAIL);
        columns.put("Status", CanonicalField.MEMBERSHIP_TYPE);

        // when
        CsvSnapshot snapshot = SnapshotParser.parse(fixture("windows-1252-semicolon-export.csv"), columns);

        // then
        assertThat(snapshot.errors()).isEmpty();
        assertThat(snapshot.ignoredColumns()).contains("Straße").doesNotContain("");
        assertThat(snapshot.rows()).hasSize(4);
        assertThat(snapshot.rows()).last().satisfies(row -> {
            assertThat(row.externalId()).isEqualTo("1000281");
            assertThat(row.values()).containsEntry(CanonicalField.MEMBERSHIP_TYPE, "Ehrenmitglied");
        });
    }

    private static byte[] fixture(String name) {
        try (InputStream stream = SnapshotParserTest.class
                .getResourceAsStream("/dataexchange/" + name)) {
            assertThat(stream).as(name).isNotNull();
            return stream.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static CsvSnapshot parse(String content) {
        return SnapshotParser.parse(content.getBytes(StandardCharsets.UTF_8), COLUMNS);
    }

    private static Map<String, CanonicalField> columns() {
        Map<String, CanonicalField> columns = new LinkedHashMap<>();
        columns.put("Member number", CanonicalField.EXTERNAL_ID);
        columns.put("First name", CanonicalField.FIRST_NAME);
        columns.put("Last name", CanonicalField.LAST_NAME);
        columns.put("Email", CanonicalField.EMAIL);
        columns.put("Category", CanonicalField.MEMBERSHIP_TYPE);
        return columns;
    }
}
