package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.internal.ImportPreviewRepository;
import org.courtside.dataexchange.internal.SnapshotHeaderInvalidException;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.courtside.dataexchange.CanonicalField.EMAIL;
import static org.courtside.dataexchange.CanonicalField.EXTERNAL_ID;
import static org.courtside.dataexchange.CanonicalField.FIRST_NAME;
import static org.courtside.dataexchange.CanonicalField.LAST_NAME;

@Import(IdentityTestFixture.class)
class PositionalImportSourceTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final Map<Integer, CanonicalField> POSITIONS =
            Map.of(1, EXTERNAL_ID, 2, FIRST_NAME, 3, LAST_NAME, 4, EMAIL);
    private static final Map<String, CanonicalField> HEADERS = Map.of(
            "Member number", EXTERNAL_ID, "First name", FIRST_NAME, "Last name", LAST_NAME);

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private PreviewService previews;

    @Autowired
    private ImportPreviewRepository stored;

    @Autowired
    private IdentityTestFixture identity;

    private UUID actor;

    @BeforeEach
    void setUp() {
        UUID admin = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        actor = identity.createAccount(admin, "admin", Set.of(Role.ADMIN));
    }

    @Test
    void givenAPositionalLayout_whenTheSourceIsCreated_thenItReadsBackByPosition() {
        // when
        UUID id = positional(POSITIONS, 5).sourceId();

        // then
        SourceConfiguration configuration = sources.configurationOf(id);
        assertThat(configuration.columnMode()).isEqualTo(ColumnMode.POSITION);
        assertThat(configuration.positions()).isEqualTo(POSITIONS);
        assertThat(configuration.columnCount()).isEqualTo(5);
        assertThat(configuration.columns()).isEmpty();
    }

    @Test
    void givenAPositionalLayoutWithoutTheLastName_whenCreatingTheSource_thenTheMissingFieldIsNamed() {
        // when / then
        assertThatThrownBy(() -> positional(Map.of(1, EXTERNAL_ID, 2, FIRST_NAME), 3))
                .isInstanceOf(ImportSourceInvalidException.class)
                .satisfies(failure -> {
                    ImportSourceInvalidException refused = (ImportSourceInvalidException) failure;
                    assertThat(refused.getCode()).isEqualTo("import.source.positions.incomplete");
                    assertThat(refused.getParams()).containsEntry("missing", java.util.List.of("LAST_NAME"));
                });
    }

    @Test
    void givenAPositionBeyondTheColumnCount_whenCreatingTheSource_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> positional(Map.of(1, EXTERNAL_ID, 2, FIRST_NAME, 6, LAST_NAME), 5))
                .isInstanceOf(ImportSourceInvalidException.class)
                .satisfies(failure -> {
                    ImportSourceInvalidException refused = (ImportSourceInvalidException) failure;
                    assertThat(refused.getCode()).isEqualTo("import.source.positions.outOfRange");
                    assertThat(refused.getParams()).containsEntry("position", 6).containsEntry("columnCount", 5);
                });
    }

    @Test
    void givenAPositionalLayoutWithoutAColumnCount_whenCreatingTheSource_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> sources.create("headerless-system", "Headerless system", ";", "UTF-8",
                new ColumnLayout(ColumnMode.POSITION, Map.of(), POSITIONS, null), Map.of(), ACTIVE_TYPE,
                Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.columnCount.outOfRange");
    }

    @Test
    void givenTwoFieldsOnOnePosition_whenCreatingTheSource_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> positional(Map.of(1, EXTERNAL_ID, 2, FIRST_NAME, 3, LAST_NAME, 4, FIRST_NAME), 4))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.positions.ambiguous");
    }

    @Test
    void givenHeadersSentWithAPositionalLayout_whenCreatingTheSource_thenItIsRefusedRatherThanIgnored() {
        // when / then
        assertThatThrownBy(() -> sources.create("headerless-system", "Headerless system", ";", "UTF-8",
                new ColumnLayout(ColumnMode.POSITION, HEADERS, POSITIONS, 5), Map.of(), ACTIVE_TYPE,
                Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.columns.unexpected");
    }

    @Test
    void givenPositionsSentWithAHeaderLayout_whenCreatingTheSource_thenItIsRefusedRatherThanIgnored() {
        // when / then
        assertThatThrownBy(() -> sources.create("roster-system", "Membership system", ",", "UTF-8",
                new ColumnLayout(ColumnMode.HEADER, HEADERS, POSITIONS, null), Map.of(), ACTIVE_TYPE,
                Set.of(), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .extracting("code").isEqualTo("import.source.positions.unexpected");
    }

    @Test
    void givenAHeaderSource_whenItIsSwitchedToPositionsWithoutConfirmation_thenNothingChanges() {
        // given
        UUID id = sources.create("roster-system", "Membership system", ";", "UTF-8",
                ColumnLayout.headers(HEADERS), Map.of(), ACTIVE_TYPE, Set.of(), 10).sourceId();

        // when / then
        assertThatThrownBy(() -> sources.change(id, "roster-system", "Membership system", ";", "UTF-8",
                ColumnLayout.positions(POSITIONS, 5), Map.of(), ACTIVE_TYPE, Set.of(), 10, false))
                .isInstanceOf(ImportSourceInvalidException.class)
                .satisfies(failure -> {
                    ImportSourceInvalidException refused = (ImportSourceInvalidException) failure;
                    assertThat(refused.getCode()).isEqualTo("import.source.columnMode.changeUnconfirmed");
                    assertThat(refused.getParams()).containsEntry("from", "HEADER").containsEntry("to", "POSITION");
                });
        assertThat(sources.configurationOf(id).columnMode()).isEqualTo(ColumnMode.HEADER);
        assertThat(sources.configurationOf(id).columns()).isEqualTo(HEADERS);
    }

    @Test
    void givenAHeaderSource_whenItIsSwitchedToPositionsWithConfirmation_thenTheNextSnapshotIsReadByPosition() {
        // given
        UUID id = sources.create("roster-system", "Membership system", ";", "UTF-8",
                ColumnLayout.headers(HEADERS), Map.of(), ACTIVE_TYPE, Set.of(), 10).sourceId();

        // when
        sources.change(id, "roster-system", "Membership system", ";", "UTF-8",
                ColumnLayout.positions(POSITIONS, 5), Map.of(), ACTIVE_TYPE, Set.of(), 10, true);

        // then
        PreviewSummary preview = preview(id, "4711;Jane;Doe;jane.doe@example.org;A\n");
        assertThat(preview.changeSet().changes()).singleElement()
                .satisfies(change -> assertThat(change.values()).containsEntry(LAST_NAME, "Doe"));
        assertThat(sources.configurationOf(id).columns()).as("the header mapping is gone, not kept beside")
                .isEmpty();
    }

    @Test
    void givenAPositionalSource_whenTwoSnapshotsArePreviewed_thenEachIsReadByTheStoredPositions() {
        // given
        UUID id = positional(POSITIONS, 5).sourceId();

        // when
        PreviewSummary january = preview(id, "4711;Jane;Doe;jane.doe@example.org;A\n");
        PreviewSummary february = preview(id, "4711;Jane;Doe;jane.doe@example.org;A\n4712;John;Roe;;B\n");

        // then
        assertThat(january.changeSet().changes()).extracting(ResolvedChangeSet.PersonChange::externalId)
                .containsExactly("4711");
        assertThat(february.changeSet().changes()).extracting(ResolvedChangeSet.PersonChange::externalId)
                .containsExactly("4711", "4712");
        assertThat(february.ignoredColumns()).containsExactly("5");
    }

    @Test
    void givenAPositionalSource_whenATruncatedExportIsUploaded_thenItIsRefusedAndNoPreviewIsStored() {
        // given
        UUID id = positional(POSITIONS, 5).sourceId();

        // when / then
        assertThatThrownBy(() -> preview(id, "4711;Jane;Doe\n4712;John;Roe\n"))
                .isInstanceOf(SnapshotHeaderInvalidException.class)
                .extracting("code").isEqualTo("import.snapshot.columns.countChanged");
        assertThat(stored.findBySourceIdAndSupersededAtIsNull(id)).isEmpty();
    }

    private SourceConfiguration positional(Map<Integer, CanonicalField> positions, int columnCount) {
        return sources.create("headerless-system", "Headerless system", ";", "UTF-8",
                ColumnLayout.positions(positions, columnCount), Map.of(), ACTIVE_TYPE, Set.of(), 10);
    }

    private PreviewSummary preview(UUID sourceId, String content) {
        return previews.create(sourceId, SnapshotMode.FULL_SNAPSHOT, "", new SnapshotUpload("roster.csv",
                "text/csv", content.getBytes(StandardCharsets.UTF_8)), actor);
    }
}
