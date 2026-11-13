package org.courtside.dataexchange;

import org.assertj.core.api.InstanceOfAssertFactories;
import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.internal.SnapshotHeaderInvalidException;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.MemberRepository;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

@ExtendWith(OutputCaptureExtension.class)
class AgeBandImportTest extends AbstractIntegrationTest {

    private static final Map<String, CanonicalField> COLUMNS = Map.of("Member number", CanonicalField.EXTERNAL_ID,
            "First name", CanonicalField.FIRST_NAME, "Last name", CanonicalField.LAST_NAME,
            "Status", CanonicalField.MEMBERSHIP_TYPE, "Born", CanonicalField.BIRTH_DATE);
    private static final String EXPORT = """
            Member number,First name,Last name,Status,Born
            4711,Jane,Doe,active,16.03.2010
            4712,John,Roe,active,2008-07-21
            4713,Mary,Major,active,1977
            4714,Richard,Miles,active,unknown
            4715,Sam,Sample,honorary,23.09.2011
            """;
    private static final List<String> FROM_THE_FILE = List.of("16.03.2010", "2008-07-21", "23.09.2011");

    @Autowired
    private PreviewService previews;
    @Autowired
    private ExecutionService executions;
    @Autowired
    private ImportSourceService sources;
    @Autowired
    private ExternalReferenceService references;
    @Autowired
    private MemberRepository members;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private MemberTestFixture memberFixture;
    @Autowired
    private JdbcClient jdbc;

    private UUID youth;
    private UUID adult;
    private UUID unsorted;
    private UUID honorary;
    private UUID actor;

    @BeforeEach
    void setUp() {
        youth = memberFixture.createMembershipType("Youth");
        adult = memberFixture.createMembershipType("Adult");
        unsorted = memberFixture.createMembershipType("Unsorted");
        honorary = memberFixture.createMembershipType("Honorary");
        actor = identity.createAccount(identity.createPerson("Richard", "Roe", "richard.roe@example.org"),
                "admin", Set.of(Role.ADMIN));
    }

    @Test
    void givenACategorySplitByBirthYear_whenAFileIsImported_thenEachRowTakesItsBandAndNothingOfTheDateIsKept(
            CapturedOutput output) {
        // given
        UUID source = splitSource(Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME,
                CanonicalField.MEMBERSHIP_TYPE));

        // when
        PreviewSummary summary = previews.create(source, SnapshotMode.FULL_SNAPSHOT, "UTF-8",
                new SnapshotUpload("members.csv", "text/csv", EXPORT.getBytes(StandardCharsets.UTF_8)), actor);
        List<String> heldWhilePreviewed = tablesHolding(FROM_THE_FILE);
        executions.execute(summary.previewId(), false, actor);

        // then
        assertThat(summary.changeSet().changes())
                .extracting(ResolvedChangeSet.PersonChange::externalId, ResolvedChangeSet.PersonChange::membershipTypeId,
                        ResolvedChangeSet.PersonChange::typeFromAgeBand)
                .containsExactlyInAnyOrder(tuple("4711", youth, true), tuple("4712", adult, true),
                        tuple("4713", adult, true), tuple("4714", unsorted, false), tuple("4715", honorary, false));
        assertThat(summary.changeSet().changes()).as("no change carries the birth date")
                .allSatisfy(change -> assertThat(change.values()).doesNotContainKey(CanonicalField.BIRTH_DATE));
        assertThat(heldWhilePreviewed).as("the stored preview holds no birth date").isEmpty();
        assertThat(summary.ageFallbackRows()).as("the row without a readable date is counted")
                .isEqualTo(Map.of("active", 1));
        Map<String, UUID> people = references.list(source, null, 50).items().stream()
                .collect(Collectors.toMap(ExternalLink::externalId, ExternalLink::personId));
        assertThat(typeOf(people.get("4711"))).isEqualTo(youth);
        assertThat(typeOf(people.get("4714"))).isEqualTo(unsorted);
        assertThat(tablesHolding(FROM_THE_FILE)).as("no table holds a birth date or year from the file").isEmpty();
        assertThat(output.getAll()).as("no log line carries one").doesNotContain("16.03.2010", "2008-07-21", "23.09.2011");
    }

    @Test
    void givenAnImportedSplit_whenTheSameFileComesAgainAndThenABirthDateChanges_thenOnlyTheChangedBandIsAnUpdate() {
        // given
        UUID source = splitSource(Set.of(CanonicalField.MEMBERSHIP_TYPE));
        executions.execute(preview(source, EXPORT).previewId(), false, actor);

        // when
        PreviewSummary again = preview(source, EXPORT);
        PreviewSummary moved = preview(source, EXPORT.replace("4711,Jane,Doe,active,16.03.2010",
                "4711,Jane,Doe,active,16.03.1990"));

        // then
        assertThat(again.changeSet().changes()).as("an unchanged band changes nothing").isEmpty();
        assertThat(moved.changeSet().changes())
                .extracting(ResolvedChangeSet.PersonChange::kind, ResolvedChangeSet.PersonChange::externalId,
                        ResolvedChangeSet.PersonChange::membershipTypeId, ResolvedChangeSet.PersonChange::typeFromAgeBand)
                .containsExactly(tuple(ResolvedChangeSet.ChangeKind.UPDATE, "4711", adult, true));
    }

    @Test
    void givenABandWhoseTypeWasRetired_whenAFileFallsIntoIt_thenTheSnapshotStopsByTheCategory() {
        // given
        UUID source = splitSource(Set.of(CanonicalField.MEMBERSHIP_TYPE));
        memberFixture.deactivateMembershipType(youth);

        // when / then
        assertThatThrownBy(() -> preview(source, EXPORT))
                .hasFieldOrPropertyWithValue("code", "import.snapshot.membershipType.inactive");
    }

    @Test
    void givenASplitSource_whenItsValueLosesItsOwnMapping_thenTheChangeIsRefusedForTheMissingFallback() {
        // given
        UUID source = splitSource(Set.of(CanonicalField.MEMBERSHIP_TYPE));

        // when / then
        assertThatThrownBy(() -> sources.change(source, "club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.headers(COLUMNS), Map.of("honorary", honorary), List.of(),
                Map.of("active", List.of(new AgeBand(0, youth))), unsorted, Set.of(CanonicalField.MEMBERSHIP_TYPE),
                10, false))
                .hasFieldOrPropertyWithValue("code", "import.source.ageBands.fallbackMissing");
    }

    @Test
    void givenASplitSource_whenTheSplitIsChangedAndThenRemoved_thenEachStoredStateReadsBack() {
        // given
        UUID source = splitSource(Set.of(CanonicalField.MEMBERSHIP_TYPE));

        // when
        SourceConfiguration rebanded = sources.change(source, "club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.headers(COLUMNS), Map.of("active", unsorted), List.of(),
                Map.of("active", List.of(new AgeBand(0, youth), new AgeBand(14, adult), new AgeBand(65, honorary))),
                unsorted, Set.of(CanonicalField.MEMBERSHIP_TYPE), 10, false);
        SourceConfiguration unsplit = sources.change(source, "club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.headers(COLUMNS), Map.of("active", unsorted), List.of("passive"), Map.of(), unsorted,
                Set.of(CanonicalField.MEMBERSHIP_TYPE), 10, false);

        // then
        assertThat(sources.configurationOf(source).ageBands()).isEmpty();
        assertThat(rebanded.ageBands().get("active")).extracting(AgeBand::fromAge).containsExactly(0, 14, 65);
        assertThat(unsplit.ageBands()).isEmpty();
    }

    @Test
    void givenASourceThatDoesNotOwnTheType_whenACategoryIsSplit_thenTheSplitIsRefusedByItsField() {
        // when / then
        assertThatThrownBy(() -> splitSource(Set.of(CanonicalField.FIRST_NAME)))
                .isInstanceOf(ImportSourceInvalidException.class)
                .hasFieldOrPropertyWithValue("code", "import.source.ageBands.membershipTypeNotOwned")
                .extracting("params").asInstanceOf(InstanceOfAssertFactories.MAP)
                .containsEntry("field", "ageBands");
    }

    @Test
    void givenBandsThatDoNotStartAtZero_whenTheSourceIsDescribed_thenTheyAreRefused() {
        // when / then
        assertThatThrownBy(() -> sources.create("club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.headers(COLUMNS), Map.of("active", unsorted), List.of(),
                Map.of("active", List.of(new AgeBand(6, youth), new AgeBand(18, adult))), unsorted,
                Set.of(CanonicalField.MEMBERSHIP_TYPE), 10))
                .hasFieldOrPropertyWithValue("code", "import.source.ageBands.startsAtZero");
    }

    @Test
    void givenASplitValueWithoutItsOwnMapping_whenTheSourceIsDescribed_thenTheMissingFallbackIsRefused() {
        // when / then
        assertThatThrownBy(() -> sources.create("club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.headers(COLUMNS), Map.of(), List.of(),
                Map.of("active", List.of(new AgeBand(0, youth))), unsorted,
                Set.of(CanonicalField.MEMBERSHIP_TYPE), 10))
                .hasFieldOrPropertyWithValue("code", "import.source.ageBands.fallbackMissing");
    }

    @Test
    void givenNoBirthDateColumn_whenACategoryIsSplit_thenTheSplitIsRefusedByItsField() {
        // when / then
        assertThatThrownBy(() -> sources.create("club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.headers(withoutBirthDate()), Map.of("active", unsorted), List.of(),
                Map.of("active", List.of(new AgeBand(0, youth), new AgeBand(18, adult))), unsorted,
                Set.of(CanonicalField.MEMBERSHIP_TYPE), 10))
                .isInstanceOf(ImportSourceInvalidException.class)
                .hasFieldOrPropertyWithValue("code", "import.source.ageBands.birthDateNotMapped")
                .extracting("params").asInstanceOf(InstanceOfAssertFactories.MAP)
                .containsEntry("field", "ageBands");
    }

    @Test
    void givenASplitSource_whenItsBirthDateColumnIsRemoved_thenTheChangeIsRefused() {
        // given
        UUID source = splitSource(Set.of(CanonicalField.MEMBERSHIP_TYPE));

        // when / then
        assertThatThrownBy(() -> sources.change(source, "club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.headers(withoutBirthDate()), Map.of("active", unsorted, "honorary", honorary),
                List.of(), Map.of("active", List.of(new AgeBand(0, youth), new AgeBand(18, adult))), unsorted,
                Set.of(CanonicalField.MEMBERSHIP_TYPE), 10, false))
                .hasFieldOrPropertyWithValue("code", "import.source.ageBands.birthDateNotMapped");
        assertThat(sources.configurationOf(source).columns())
                .as("the stored source keeps its birth date column").containsValue(CanonicalField.BIRTH_DATE);
    }

    @Test
    void givenAStoredSplitWithoutABirthDateColumn_whenAFileIsPreviewed_thenThePreviewIsRefused() {
        // given
        UUID source = splitSource(Set.of(CanonicalField.MEMBERSHIP_TYPE));
        jdbc.sql("DELETE FROM import_column_mapping WHERE source_id = :source AND canonical_field = 'BIRTH_DATE'")
                .param("source", source).update();

        // when / then
        assertThatThrownBy(() -> preview(source, EXPORT))
                .isInstanceOf(ImportSourceInvalidException.class)
                .hasFieldOrPropertyWithValue("code", "import.source.ageBands.birthDateNotMapped");
    }

    @Test
    void givenAnImportedSplit_whenAFileLacksTheBirthDateColumn_thenItIsRefusedAndNoMembershipChanges() {
        // given
        UUID source = splitSource(Set.of(CanonicalField.MEMBERSHIP_TYPE));
        executions.execute(preview(source, EXPORT).previewId(), false, actor);
        String withoutBorn = EXPORT.lines().map(line -> line.substring(0, line.lastIndexOf(',')))
                .collect(Collectors.joining("\n", "", "\n"));

        // when / then
        assertThatThrownBy(() -> preview(source, withoutBorn))
                .isInstanceOf(SnapshotHeaderInvalidException.class)
                .hasFieldOrPropertyWithValue("code", "import.snapshot.header.missingField")
                .extracting("params").asInstanceOf(InstanceOfAssertFactories.MAP)
                .containsEntry("missing", List.of("BIRTH_DATE"));
        Map<String, UUID> people = references.list(source, null, 50).items().stream()
                .collect(Collectors.toMap(ExternalLink::externalId, ExternalLink::personId));
        assertThat(typeOf(people.get("4711"))).as("the youth band stays").isEqualTo(youth);
        assertThat(typeOf(people.get("4712"))).as("the adult band stays").isEqualTo(adult);
    }

    @Test
    void givenASplitReadByPosition_whenAFileLacksTheBirthDateColumn_thenItIsRefusedBeforeAPreview() {
        // given
        UUID source = sources.create("club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.positions(Map.of(1, CanonicalField.EXTERNAL_ID, 2, CanonicalField.FIRST_NAME,
                        3, CanonicalField.LAST_NAME, 4, CanonicalField.MEMBERSHIP_TYPE, 5, CanonicalField.BIRTH_DATE), 5),
                Map.of("active", unsorted), List.of(),
                Map.of("active", List.of(new AgeBand(0, youth), new AgeBand(18, adult))), unsorted,
                Set.of(CanonicalField.MEMBERSHIP_TYPE), 10).sourceId();

        // when / then
        assertThatThrownBy(() -> preview(source, "4711,Jane,Doe,active\n"))
                .isInstanceOf(SnapshotHeaderInvalidException.class)
                .hasFieldOrPropertyWithValue("code", "import.snapshot.columns.countChanged")
                .extracting("params").asInstanceOf(InstanceOfAssertFactories.MAP)
                .containsEntry("expected", 5).containsEntry("found", 4);
        assertThat(references.list(source, null, 50).items()).as("no member was linked").isEmpty();
    }

    @Test
    void givenABirthDateAtAPosition_whenACategoryIsSplit_thenTheSplitIsStored() {
        // when
        SourceConfiguration described = sources.create("club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.positions(Map.of(1, CanonicalField.EXTERNAL_ID, 2, CanonicalField.FIRST_NAME,
                        3, CanonicalField.LAST_NAME, 4, CanonicalField.MEMBERSHIP_TYPE, 5, CanonicalField.BIRTH_DATE), 5),
                Map.of("active", unsorted), List.of(),
                Map.of("active", List.of(new AgeBand(0, youth), new AgeBand(18, adult))), unsorted,
                Set.of(CanonicalField.MEMBERSHIP_TYPE), 10);

        // then
        assertThat(described.ageBands().get("active")).extracting(AgeBand::fromAge).containsExactly(0, 18);
    }

    @Test
    void givenTheBirthDate_whenASourceWouldOwnIt_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> sources.create("club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.headers(COLUMNS), Map.of("active", unsorted), List.of(), Map.of(), unsorted,
                Set.of(CanonicalField.BIRTH_DATE), 10))
                .hasFieldOrPropertyWithValue("code", "import.source.ownedFields.birthDate");
    }

    private PreviewSummary preview(UUID source, String content) {
        return previews.create(source, SnapshotMode.UPDATE_ONLY, "UTF-8",
                new SnapshotUpload("members.csv", "text/csv", content.getBytes(StandardCharsets.UTF_8)), actor);
    }

    private UUID splitSource(Set<CanonicalField> owned) {
        return sources.create("club-registry", "Club registry", ",", "UTF-8", ColumnLayout.headers(COLUMNS),
                Map.of("active", unsorted, "honorary", honorary), List.of(),
                Map.of("active", List.of(new AgeBand(0, youth), new AgeBand(18, adult))), unsorted,
                owned, 10).sourceId();
    }

    private static Map<String, CanonicalField> withoutBirthDate() {
        return COLUMNS.entrySet().stream().filter(column -> column.getValue() != CanonicalField.BIRTH_DATE)
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    private UUID typeOf(UUID personId) {
        return members.findByPersonIdOrderByStartedOnAscIdAsc(personId).getLast().getMembershipTypeId();
    }

    private List<String> tablesHolding(List<String> values) {
        List<String> tables = jdbc.sql("""
                        SELECT table_name FROM information_schema.tables
                        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
                        """).query(String.class).list();
        return tables.stream().filter(table -> values.stream().anyMatch(value -> jdbc.sql(
                        "SELECT count(*) FROM \"" + table + "\" t WHERE t::text LIKE :value")
                .param("value", "%" + value + "%").query(Long.class).single() > 0)).toList();
    }
}
