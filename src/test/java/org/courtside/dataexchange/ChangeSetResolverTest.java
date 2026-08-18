package org.courtside.dataexchange;

import org.courtside.dataexchange.internal.ChangeSetResolver;
import org.courtside.dataexchange.internal.CsvSnapshot;
import org.courtside.dataexchange.internal.CurrentRoster;
import org.courtside.dataexchange.internal.SnapshotBlockedException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ChangeSetResolverTest {

    private static final UUID SOURCE = UUID.randomUUID();
    private static final UUID ACTIVE_TYPE = UUID.randomUUID();
    private static final UUID RETIRED_TYPE = UUID.randomUUID();
    private static final UUID JANE = UUID.randomUUID();

    @Test
    void givenAMemberNumberThisSourceDoesNotKnow_whenResolving_thenItBecomesACreation() {
        // given
        CsvSnapshot snapshot = snapshotOf(row(1, "4711", "Jane", "Doe"));

        // when
        ResolvedChangeSet resolved = resolve(snapshot, SnapshotMode.FULL_SNAPSHOT, emptyRoster());

        // then
        assertThat(resolved.changes()).singleElement().satisfies(change -> {
            assertThat(change.kind()).isEqualTo(ResolvedChangeSet.ChangeKind.CREATE);
            assertThat(change.externalId()).isEqualTo("4711");
            assertThat(change.personId()).isNull();
            assertThat(change.values()).containsEntry(CanonicalField.FIRST_NAME, "Jane");
        });
        assertThat(resolved.duplicates()).isEmpty();
    }

    @Test
    void givenAKnownRecordWhoseOwnedFieldsDiffer_whenResolving_thenExactlyThoseFieldsAreUpdated() {
        // given
        CsvSnapshot snapshot = snapshotOf(row(1, "4711", "Jane", "Roe"));

        // when
        ResolvedChangeSet resolved = resolve(snapshot, SnapshotMode.FULL_SNAPSHOT,
                rosterHolding(JANE, "4711", "Jane", "Doe"));

        // then
        assertThat(resolved.changes()).singleElement().satisfies(change -> {
            assertThat(change.kind()).isEqualTo(ResolvedChangeSet.ChangeKind.UPDATE);
            assertThat(change.personId()).isEqualTo(JANE);
            assertThat(change.values()).containsExactly(
                    Map.entry(CanonicalField.LAST_NAME, "Roe"));
        });
    }

    @Test
    void givenAKnownRecordWhoseUnownedFieldsDiffer_whenResolving_thenTheClubsOwnValueStands() {
        // given
        CsvSnapshot snapshot = snapshotOf(row(1, "4711", "Jane", "Doe",
                Map.of(CanonicalField.EMAIL, "jane.doe@example.com")));

        // when — the source owns names only, so the address it carries is not its to write, and
        // the roster's own jane.doe@example.org has to survive a file that disagrees with it
        ResolvedChangeSet resolved = resolve(snapshot, SnapshotMode.FULL_SNAPSHOT,
                rosterHolding(JANE, "4711", "Jane", "Doe"));

        // then
        assertThat(resolved.changes()).isEmpty();
    }

    @Test
    void givenACreationWhoseCategoryCellIsEmpty_whenResolving_thenItTakesTheSourcesDefault() {
        // given
        CsvSnapshot snapshot = snapshotOf(row(1, "4711", "Jane", "Doe"));

        // when
        ResolvedChangeSet resolved = resolve(snapshot, SnapshotMode.FULL_SNAPSHOT, emptyRoster());

        // then
        assertThat(resolved.changes()).singleElement()
                .satisfies(change -> assertThat(change.membershipTypeId()).isEqualTo(ACTIVE_TYPE));
    }

    @Test
    void givenAKnownRecordWhoseCategoryCellIsEmpty_whenResolving_thenItsTypeIsLeftAlone() {
        // given
        CsvSnapshot snapshot = snapshotOf(row(1, "4711", "Jane", "Doe"));

        // when
        ResolvedChangeSet resolved = ChangeSetResolver.resolve(snapshot, owningMembershipType(),
                SnapshotMode.FULL_SNAPSHOT, rosterHoldingType(RETIRED_TYPE));

        // then
        assertThat(resolved.changes()).isEmpty();
    }

    @Test
    void givenAKnownRecordWhoseCategoryCellNamesAType_whenResolving_thenItIsWritten() {
        // given
        CsvSnapshot snapshot = snapshotOf(row(1, "4711", "Jane", "Doe",
                Map.of(CanonicalField.MEMBERSHIP_TYPE, "A")));

        // when
        ResolvedChangeSet resolved = ChangeSetResolver.resolve(snapshot, owningMembershipType(),
                SnapshotMode.FULL_SNAPSHOT, rosterHoldingType(RETIRED_TYPE));

        // then
        assertThat(resolved.changes()).singleElement()
                .satisfies(change -> assertThat(change.membershipTypeId()).isEqualTo(ACTIVE_TYPE));
    }

    @Test
    void givenAKnownRecordAbsentFromAFullSnapshot_whenResolving_thenItsMembershipEnds() {
        // given
        CsvSnapshot snapshot = snapshotOf();

        // when
        ResolvedChangeSet resolved = resolve(snapshot, SnapshotMode.FULL_SNAPSHOT,
                rosterHolding(JANE, "4711", "Jane", "Doe"));

        // then
        assertThat(resolved.changes()).singleElement().satisfies(change -> {
            assertThat(change.kind()).isEqualTo(ResolvedChangeSet.ChangeKind.END_MEMBERSHIP);
            assertThat(change.personId()).isEqualTo(JANE);
        });
        assertThat(resolved.removals().count()).isEqualTo(1);
        assertThat(resolved.removals().percent()).isEqualTo(100);
    }

    @Test
    void givenAShareJustAboveTheThreshold_whenResolving_thenItIsNotRoundedBackOntoIt() {
        // given
        CurrentRoster roster = rosterOfThree();

        // when
        ResolvedChangeSet resolved = resolve(snapshotOf(row(1, "4712", "John", "Roe"),
                row(2, "4713", "Mary", "Major")), SnapshotMode.FULL_SNAPSHOT, roster);

        // then
        assertThat(resolved.removals().count()).isEqualTo(1);
        assertThat(resolved.removals().percent()).isEqualTo(34);
    }

    @Test
    void givenAKnownRecordAbsentFromAnUpdateOnlyUpload_whenResolving_thenNothingHappensToIt() {
        // given
        CsvSnapshot snapshot = snapshotOf();

        // when
        ResolvedChangeSet resolved = resolve(snapshot, SnapshotMode.UPDATE_ONLY,
                rosterHolding(JANE, "4711", "Jane", "Doe"));

        // then
        assertThat(resolved.changes()).isEmpty();
        assertThat(resolved.removals().count()).isZero();
        assertThat(resolved.removals().percent()).isZero();
    }

    @Test
    void givenAMembershipTypeValueTheSourceDoesNotMap_whenResolving_thenTheWholeFileIsBlocked() {
        // given
        CsvSnapshot snapshot = snapshotOf(row(1, "4711", "Jane", "Doe",
                Map.of(CanonicalField.MEMBERSHIP_TYPE, "Honorary")));

        // when / then
        assertThatThrownBy(() -> resolve(snapshot, SnapshotMode.FULL_SNAPSHOT, emptyRoster()))
                .isInstanceOf(SnapshotBlockedException.class)
                .extracting("code").isEqualTo("import.snapshot.membershipType.unmapped");
    }

    @Test
    void givenAMappedMembershipTypeThatIsNoLongerOffered_whenResolving_thenTheWholeFileIsBlocked() {
        // given
        CsvSnapshot snapshot = snapshotOf(row(1, "4711", "Jane", "Doe",
                Map.of(CanonicalField.MEMBERSHIP_TYPE, "B")));

        // when / then
        assertThatThrownBy(() -> resolve(snapshot, SnapshotMode.FULL_SNAPSHOT, emptyRoster()))
                .isInstanceOf(SnapshotBlockedException.class)
                .extracting("code").isEqualTo("import.snapshot.membershipType.inactive");
    }

    @Test
    void givenACreationNamingSomebodyTheRosterAlreadyHolds_whenResolving_thenItIsStillACreation() {
        // given
        CsvSnapshot snapshot = snapshotOf(row(1, "4711", "Jane", "Doe"));
        CurrentRoster roster = new CurrentRoster(Map.of(), Map.of(), Set.of(ACTIVE_TYPE),
                Map.of("jane doe", List.of(JANE)));

        // when
        ResolvedChangeSet resolved = resolve(snapshot, SnapshotMode.FULL_SNAPSHOT, roster);

        // then
        assertThat(resolved.changes()).singleElement()
                .satisfies(change -> assertThat(change.kind())
                        .isEqualTo(ResolvedChangeSet.ChangeKind.CREATE));
        assertThat(resolved.duplicates()).singleElement().satisfies(duplicate -> {
            assertThat(duplicate.externalId()).isEqualTo("4711");
            assertThat(duplicate.personId()).isEqualTo(JANE);
        });
    }

    @Test
    void givenARowTheParserCouldNotRead_whenResolving_thenItIsCarriedThroughUntouched() {
        // given
        CsvSnapshot snapshot = new CsvSnapshot(List.of(),
                List.of(new CsvSnapshot.RowError(3, "import.snapshot.row.cellsMissing", Map.of())),
                List.of());

        // when
        ResolvedChangeSet resolved = resolve(snapshot, SnapshotMode.FULL_SNAPSHOT, emptyRoster());

        // then
        assertThat(resolved.errors()).singleElement()
                .satisfies(error -> assertThat(error.rowNumber()).isEqualTo(3));
    }

    @Test
    void givenAMemberWhoseMembershipAlreadyEnded_whenTheyAreAbsentAgain_thenNothingEndsTwice() {
        // given
        CsvSnapshot snapshot = snapshotOf();
        CurrentRoster roster = new CurrentRoster(Map.of("4711", JANE),
                Map.of(JANE, new CurrentRoster.RosterPerson(JANE, "Jane", "Doe",
                        "jane.doe@example.org", ACTIVE_TYPE, false)),
                Set.of(ACTIVE_TYPE), Map.of());

        // when
        ResolvedChangeSet resolved = resolve(snapshot, SnapshotMode.FULL_SNAPSHOT, roster);

        // then
        assertThat(resolved.changes()).isEmpty();
        assertThat(resolved.removals().count()).isZero();
    }

    private static ResolvedChangeSet resolve(CsvSnapshot snapshot, SnapshotMode mode,
                                             CurrentRoster roster) {
        return ChangeSetResolver.resolve(snapshot, configuration(), mode, roster);
    }

    private static SourceConfiguration configuration() {
        return new SourceConfiguration(SOURCE, "roster-system", "Membership system",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL,
                        "Category", CanonicalField.MEMBERSHIP_TYPE),
                Map.of("A", ACTIVE_TYPE, "B", RETIRED_TYPE), ACTIVE_TYPE,
                Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME), 10);
    }

    private static CsvSnapshot snapshotOf(CsvSnapshot.SnapshotRow... rows) {
        return new CsvSnapshot(List.of(rows), List.of(), List.of());
    }

    private static CsvSnapshot.SnapshotRow row(int rowNumber, String externalId, String firstName,
                                               String lastName) {
        return row(rowNumber, externalId, firstName, lastName, Map.of());
    }

    private static CsvSnapshot.SnapshotRow row(int rowNumber, String externalId, String firstName,
                                               String lastName,
                                               Map<CanonicalField, String> extra) {
        Map<CanonicalField, String> values = new java.util.EnumMap<>(CanonicalField.class);
        values.put(CanonicalField.FIRST_NAME, firstName);
        values.put(CanonicalField.LAST_NAME, lastName);
        values.put(CanonicalField.EMAIL, "jane.doe@example.org");
        values.putAll(extra);
        return new CsvSnapshot.SnapshotRow(rowNumber, externalId, values);
    }

    private static CurrentRoster emptyRoster() {
        return new CurrentRoster(Map.of(), Map.of(), Set.of(ACTIVE_TYPE), Map.of());
    }

    private static SourceConfiguration owningMembershipType() {
        SourceConfiguration base = configuration();
        return new SourceConfiguration(base.sourceId(), base.sourceKey(), base.displayName(),
                base.columns(), base.membershipTypes(), base.defaultMembershipTypeId(),
                Set.of(CanonicalField.MEMBERSHIP_TYPE), base.removalWarningPercent());
    }

    private static CurrentRoster rosterHoldingType(UUID membershipTypeId) {
        return new CurrentRoster(Map.of("4711", JANE),
                Map.of(JANE, new CurrentRoster.RosterPerson(JANE, "Jane", "Doe",
                        "jane.doe@example.org", membershipTypeId, true)),
                Set.of(ACTIVE_TYPE, RETIRED_TYPE), Map.of());
    }

    private static CurrentRoster rosterOfThree() {
        UUID john = UUID.fromString("dddddddd-0000-0000-0000-000000000002");
        UUID mary = UUID.fromString("dddddddd-0000-0000-0000-000000000003");
        return new CurrentRoster(
                Map.of("4711", JANE, "4712", john, "4713", mary),
                Map.of(JANE, person(JANE, "Jane", "Doe"),
                        john, person(john, "John", "Roe"),
                        mary, person(mary, "Mary", "Major")),
                Set.of(ACTIVE_TYPE), Map.of());
    }

    private static CurrentRoster.RosterPerson person(UUID personId, String firstName, String lastName) {
        return new CurrentRoster.RosterPerson(personId, firstName, lastName,
                firstName.toLowerCase(java.util.Locale.ROOT) + "@example.org", ACTIVE_TYPE, true);
    }

    private static CurrentRoster rosterHolding(UUID personId, String externalId, String firstName,
                                               String lastName) {
        return new CurrentRoster(Map.of(externalId, personId),
                Map.of(personId, new CurrentRoster.RosterPerson(personId, firstName, lastName,
                        "jane.doe@example.org", ACTIVE_TYPE, true)),
                Set.of(ACTIVE_TYPE), Map.of());
    }
}
