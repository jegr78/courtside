package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.MemberRepository;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({IdentityTestFixture.class, MemberTestFixture.class})
class ExecutionServiceTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String TWO_MEMBERS = """
            Member number,First name,Last name,Email
            4711,Jane,Doe,jane.doe@example.org
            4712,John,Roe,john.roe@example.org
            """;

    @Autowired
    private PreviewService previews;

    @Autowired
    private ExecutionService executions;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private ExternalReferenceService references;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberRepository members;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberTestFixture memberFixture;

    private UUID source;
    private UUID actor;

    @BeforeEach
    void setUp() {
        source = sources.create("roster-system", "Membership system", ",",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), ACTIVE_TYPE, Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME,
                        CanonicalField.EMAIL), 10).sourceId();
        UUID admin = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        actor = identity.createAccount(admin, "admin", Set.of(Role.ADMIN));
    }

    @Test
    void givenAReviewedPreview_whenItIsExecuted_thenEveryRecordExistsAndIsLinked() {
        // given
        UUID previewId = preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT);

        // when
        RunOutcome outcome = executions.execute(previewId, false, actor);

        // then
        assertThat(outcome.created()).isEqualTo(2);
        assertThat(personIdsOf(source)).hasSize(2);
        assertThat(members.findAll()).hasSize(2);
    }

    @Test
    void givenAnExecutedSnapshot_whenTheIdenticalFileIsUploadedAndExecutedAgain_thenNothingChanges() {
        // given
        executions.execute(preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT), false, actor);
        long peopleBefore = persons.count();
        long membershipsBefore = members.count();
        long referencesBefore = references.list(source, null, 200).items().size();
        long accountsBefore = accounts.count();

        // when
        RunOutcome second = executions.execute(preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT),
                false, actor);

        // then
        assertThat(second.created()).isZero();
        assertThat(second.corrected()).isZero();
        assertThat(second.membershipsEnded()).isZero();
        assertThat(persons.count()).isEqualTo(peopleBefore);
        assertThat(members.count()).isEqualTo(membershipsBefore);
        assertThat(references.list(source, null, 200).items()).hasSize((int) referencesBefore);
        assertThat(accounts.count()).isEqualTo(accountsBefore);
    }

    @Test
    void givenAPreviewThatWouldEndAMembership_whenSomebodyItTouchesChangedSince_thenItIsRefused() {
        // given
        executions.execute(preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT), false, actor);
        UUID previewId = preview("""
                Member number,First name,Last name,Email
                4711,Jane,Roe,jane.doe@example.org
                4712,John,Roe,john.roe@example.org
                """, SnapshotMode.FULL_SNAPSHOT);
        UUID jane = personIdsOf(source).get("4711");
        rename(jane, "Janet");

        // when / then
        assertThatThrownBy(() -> executions.execute(previewId, false, actor))
                .isInstanceOf(ImportPreviewStaleException.class);
        assertThat(persons.findById(jane).orElseThrow().getFirstName()).isEqualTo("Janet");
    }

    @Test
    void givenTheSamePreview_whenOnlySomebodyItDoesNotTouchChanged_thenItStillRuns() {
        // given
        executions.execute(preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT), false, actor);
        UUID previewId = preview("""
                Member number,First name,Last name,Email
                4711,Jane,Roe,jane.doe@example.org
                4712,John,Roe,john.roe@example.org
                """, SnapshotMode.FULL_SNAPSHOT);
        rename(identity.createPerson("Mary", "Major", "mary.major@example.org"), "Maria");

        // when
        RunOutcome outcome = executions.execute(previewId, false, actor);

        // then
        assertThat(outcome.corrected()).isEqualTo(1);
        UUID jane = personIdsOf(source).get("4711");
        assertThat(persons.findById(jane).orElseThrow().getLastName()).isEqualTo("Roe");
    }

    @Test
    void givenMoreRemovalsThanTheSourceAllows_whenExecutingWithoutConfirmation_thenItIsRefused() {
        // given
        executions.execute(preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT), false, actor);
        UUID previewId = preview("""
                Member number,First name,Last name,Email
                4711,Jane,Doe,jane.doe@example.org
                """, SnapshotMode.FULL_SNAPSHOT);

        // when / then
        assertThatThrownBy(() -> executions.execute(previewId, false, actor))
                .isInstanceOf(RemovalsNeedConfirmationException.class);
        assertThat(members.findAll()).allSatisfy(member -> assertThat(member.isCurrent()).isTrue());
    }

    @Test
    void givenTheSameRemovals_whenTheyAreConfirmed_thenTheRunProceeds() {
        // given
        executions.execute(preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT), false, actor);
        UUID previewId = preview("""
                Member number,First name,Last name,Email
                4711,Jane,Doe,jane.doe@example.org
                """, SnapshotMode.FULL_SNAPSHOT);

        // when
        RunOutcome outcome = executions.execute(previewId, true, actor);

        // then
        assertThat(outcome.membershipsEnded()).isEqualTo(1);
        assertThat(outcome.removalsConfirmed()).isTrue();
        UUID john = personIdsOf(source).get("4712");
        assertThat(members.findCurrentByPersonId(john)).isEmpty();
    }

    @Test
    void givenAnExecutedPreview_whenItIsExecutedASecondTime_thenItIsRefusedAsSuperseded() {
        // given
        UUID previewId = preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT);
        executions.execute(previewId, false, actor);

        // when / then
        assertThatThrownBy(() -> executions.execute(previewId, false, actor))
                .isInstanceOf(ImportPreviewSupersededException.class);
    }

    @Test
    void givenAnOlderPreviewOfTheSameSource_whenANewerOneIsExecuted_thenTheOlderCannotRun() {
        // given
        UUID older = preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT);
        UUID newer = preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT);

        // when
        executions.execute(newer, false, actor);

        // then
        assertThatThrownBy(() -> executions.execute(older, false, actor))
                .isInstanceOf(ImportPreviewSupersededException.class);
    }

    @Test
    void givenAMembershipTypeDeactivatedAfterThePreview_whenExecuting_thenNothingIsWrittenAtAll() {
        // given
        UUID typed = sources.create("club-registry", "The other system", ",",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL,
                        "Category", CanonicalField.MEMBERSHIP_TYPE),
                Map.of("A", ACTIVE_TYPE), ACTIVE_TYPE, Set.of(CanonicalField.MEMBERSHIP_TYPE), 10).sourceId();
        UUID previewId = previews.create(typed, SnapshotMode.FULL_SNAPSHOT, "UTF-8", "roster.csv", """
                Member number,First name,Last name,Email,Category
                4711,Jane,Doe,jane.doe@example.org,A
                4712,John,Roe,john.roe@example.org,A
                """.getBytes(StandardCharsets.UTF_8), actor).previewId();
        long peopleBefore = persons.count();
        memberFixture.deactivateMembershipType(ACTIVE_TYPE);

        // when / then
        assertThatThrownBy(() -> executions.execute(previewId, false, actor))
                .isInstanceOf(RuntimeException.class);
        assertThat(persons.count()).isEqualTo(peopleBefore);
        assertThat(members.count()).isZero();
        assertThat(references.list(typed, null, 200).items()).isEmpty();
    }

    @Test
    void givenAnExecutedPreview_whenTheRunLogIsRead_thenItKeepsTheHashAndTheCountsAndNoRoster() {
        // given
        UUID previewId = preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT);
        RunOutcome outcome = executions.execute(previewId, false, actor);

        // then
        assertThat(executions.runsOf(source)).singleElement().satisfies(run -> {
            assertThat(run.runId()).isEqualTo(outcome.runId());
            assertThat(run.fileHash()).matches("[0-9a-f]{64}");
            assertThat(run.created()).isEqualTo(2);
        });
        assertThat(previews.read(previewId).changeSet()).isNull();
    }

    @Test
    void givenARowWhoseOwnedNameCellIsEmpty_whenPreviewing_thenItFailsThatRowRatherThanTheRun() {
        // when
        PreviewSummary summary = previews.create(source, SnapshotMode.FULL_SNAPSHOT, "UTF-8", "roster.csv",
                """
                Member number,First name,Last name,Email
                4711,,Doe,jane.doe@example.org
                4712,John,Roe,john.roe@example.org
                """.getBytes(StandardCharsets.UTF_8), actor);

        // then
        assertThat(summary.changeSet().errors()).singleElement().satisfies(error -> {
            assertThat(error.code()).isEqualTo("import.snapshot.row.valueUnusable");
            assertThat(error.params()).containsEntry("canonicalField", "FIRST_NAME");
        });
        assertThat(executions.execute(summary.previewId(), false, actor).created()).isEqualTo(1);
    }

    @Test
    void givenARowWhoseAddressIsNotOne_whenPreviewing_thenItFailsThatRow() {
        // when
        PreviewSummary summary = previews.create(source, SnapshotMode.FULL_SNAPSHOT, "UTF-8", "roster.csv",
                """
                Member number,First name,Last name,Email
                4711,Jane,Doe,not-an-address
                """.getBytes(StandardCharsets.UTF_8), actor);

        // then
        assertThat(summary.changeSet().errors()).singleElement()
                .satisfies(error -> assertThat(error.params())
                        .containsEntry("canonicalField", "EMAIL"));
        assertThat(summary.changeSet().changes()).isEmpty();
    }

    @Test
    void givenAMemberNumberLinkedAfterThePreview_whenExecuting_thenNoSecondRecordIsCreated() {
        // given
        UUID previewId = preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT);
        UUID somebody = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        references.link(source, "4711", somebody);
        long peopleBefore = persons.count();

        // when / then
        assertThatThrownBy(() -> executions.execute(previewId, false, actor))
                .isInstanceOf(ImportPreviewStaleException.class);
        assertThat(persons.count()).isEqualTo(peopleBefore);
    }

    @Test
    void givenASourceThatHasRun_whenItsReferencesAreGoneAndItIsDeleted_thenItIsStillRefused() {
        // given
        executions.execute(preview(TWO_MEMBERS, SnapshotMode.FULL_SNAPSHOT), false, actor);
        references.unlink(source, "4711");
        references.unlink(source, "4712");

        // when / then
        assertThatThrownBy(() -> sources.delete(source))
                .isInstanceOf(ImportSourceInUseException.class);
        assertThat(executions.runsOf(source)).hasSize(1);
    }

    private UUID preview(String content, SnapshotMode mode) {
        return previews.create(source, mode, "UTF-8", "roster.csv",
                content.getBytes(StandardCharsets.UTF_8), actor).previewId();
    }

    private Map<String, UUID> personIdsOf(UUID sourceId) {
        return references.list(sourceId, null, 50).items().stream()
                .collect(Collectors.toMap(ExternalLink::externalId, ExternalLink::personId));
    }

    private void rename(UUID personId, String firstName) {
        identity.renamePerson(personId, firstName, persons.findById(personId).orElseThrow().getLastName());
    }
}
