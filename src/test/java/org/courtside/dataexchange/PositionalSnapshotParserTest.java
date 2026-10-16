package org.courtside.dataexchange;

import org.courtside.dataexchange.internal.CsvSnapshot;
import org.courtside.dataexchange.internal.SnapshotHeaderInvalidException;
import org.courtside.dataexchange.internal.SnapshotParser;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PositionalSnapshotParserTest {

    private static final Map<Integer, CanonicalField> POSITIONS = Map.of(
            1, CanonicalField.EXTERNAL_ID,
            3, CanonicalField.LAST_NAME,
            2, CanonicalField.FIRST_NAME,
            5, CanonicalField.EMAIL);

    @Test
    void givenAHeaderlessExport_whenParsedTwiceByPosition_thenEveryRowCarriesTheSameFieldsBothTimes() {
        // given
        String first = "4711;Jane;Doe;A;jane.doe@example.org\n4712;John;Roe;B;\n";
        String second = "4711;Jane;Doe-Major;A;jane.doe@example.org\n4713;Mary;Major;A;mary@example.org\n";

        // when
        CsvSnapshot january = parse(first);
        CsvSnapshot february = parse(second);

        // then
        assertThat(january.errors()).isEmpty();
        assertThat(january.rows()).extracting(CsvSnapshot.SnapshotRow::externalId).containsExactly("4711", "4712");
        assertThat(january.rows().getFirst().values()).isEqualTo(Map.of(
                CanonicalField.FIRST_NAME, "Jane", CanonicalField.LAST_NAME, "Doe",
                CanonicalField.EMAIL, "jane.doe@example.org"));
        assertThat(february.rows().getFirst().values()).containsEntry(CanonicalField.LAST_NAME, "Doe-Major");
        assertThat(february.rows().get(1).values()).containsEntry(CanonicalField.FIRST_NAME, "Mary");
    }

    @Test
    void givenAPositionTheMappingDoesNotName_whenParsing_thenItIsReportedByItsNumber() {
        // when
        CsvSnapshot snapshot = parse("4711;Jane;Doe;A;jane.doe@example.org\n");

        // then
        assertThat(snapshot.ignoredColumns()).as("position 4 carries a value no field is mapped to")
                .containsExactly("4");
    }

    @Test
    void givenAnExportWithFewerColumnsThanTheSourceDescribes_whenParsing_thenTheWholeFileIsRefused() {
        // when / then
        assertThatThrownBy(() -> parse("4711;Jane;Doe;A\n4712;John;Roe;B\n"))
                .isInstanceOf(SnapshotHeaderInvalidException.class)
                .satisfies(failure -> {
                    SnapshotHeaderInvalidException refused = (SnapshotHeaderInvalidException) failure;
                    assertThat(refused.getCode()).isEqualTo("import.snapshot.columns.countChanged");
                    assertThat(refused.getParams()).containsEntry("expected", 5).containsEntry("found", 4);
                });
    }

    @Test
    void givenAnExportThatGainedAColumn_whenParsing_thenTheWholeFileIsRefused() {
        // when / then
        assertThatThrownBy(() -> parse("4711;Jane;Doe;A;jane.doe@example.org;extra\n"))
                .isInstanceOf(SnapshotHeaderInvalidException.class)
                .extracting("code").isEqualTo("import.snapshot.columns.countChanged");
    }

    @Test
    void givenAFileWithoutAnyRow_whenParsingByPosition_thenTheWholeFileIsRefused() {
        // when / then
        assertThatThrownBy(() -> parse("\n\n"))
                .isInstanceOf(SnapshotHeaderInvalidException.class)
                .extracting("code").isEqualTo("import.snapshot.columns.countChanged");
    }

    @Test
    void givenOneRowCutShortInsideAnIntactExport_whenParsing_thenOnlyThatRowFails() {
        // when
        CsvSnapshot snapshot = parse("4711;Jane;Doe;A;jane.doe@example.org\n4712;John\n");

        // then
        assertThat(snapshot.rows()).extracting(CsvSnapshot.SnapshotRow::externalId).containsExactly("4711");
        assertThat(snapshot.errors()).singleElement().satisfies(error -> {
            assertThat(error.rowNumber()).isEqualTo(2);
            assertThat(error.code()).isEqualTo("import.snapshot.row.columnsMissing");
            assertThat(error.params()).containsEntry("expected", 5).containsEntry("found", 2);
        });
    }

    private static CsvSnapshot parse(String content) {
        return SnapshotParser.parsePositions(content.getBytes(StandardCharsets.UTF_8), POSITIONS, 5,
                StandardCharsets.UTF_8, ';');
    }
}
