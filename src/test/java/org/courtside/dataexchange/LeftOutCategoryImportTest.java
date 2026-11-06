package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.internal.ImportPreviewRepository;
import org.courtside.dataexchange.internal.SnapshotBlockedException;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.MemberRepository;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

@Import({IdentityTestFixture.class, MemberTestFixture.class})
class LeftOutCategoryImportTest extends AbstractIntegrationTest {

    private static final String FULL_EXPORT = """
            Member number,First name,Last name,Email,Status
            4711,Jane,Doe,jane.doe@example.org,active
            4712,John,Roe,john.roe@example.org,active
            4713,Mary,Major,mary.major@example.org,resigned
            ,Peter,Poe,,deceased
            4713,Sam,Sample,sam.sample@example.org,resigned
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
    private ImportPreviewRepository storedPreviews;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private MemberRepository members;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture memberFixture;

    private UUID source;
    private UUID actor;

    @BeforeEach
    void setUp() {
        UUID granting = memberFixture.membershipTypeGrantingAnAccount("Playing members");
        source = sources.create("club-registry", "Club registry", ",", "UTF-8",
                ColumnLayout.headers(Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL,
                        "Status", CanonicalField.MEMBERSHIP_TYPE)),
                Map.of("active", granting), List.of("resigned", "deceased"), Map.of(), granting,
                Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME, CanonicalField.EMAIL,
                        CanonicalField.MEMBERSHIP_TYPE), 10).sourceId();
        UUID admin = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        actor = identity.createAccount(admin, "admin", Set.of(Role.ADMIN));
    }

    @Test
    void givenAFullExportWithLeftOutCategories_whenPreviewedAndExecuted_thenOnlyTheMappedRowsAreImported() {
        // given
        long peopleBefore = persons.count();

        // when
        PreviewSummary summary = preview(FULL_EXPORT, SnapshotMode.FULL_SNAPSHOT);
        String stored = storedPreviews.findById(summary.previewId()).orElseThrow().getChangeSet();
        RunOutcome outcome = executions.execute(summary.previewId(), false, actor);

        // then
        assertThat(summary.leftOutRows()).isEqualTo(Map.of("resigned", 2, "deceased", 1));
        assertThat(summary.rowCount()).as("left-out rows are not rows of the snapshot").isEqualTo(2);
        assertThat(summary.changeSet().errors()).as("a left-out row is never validated").isEmpty();
        assertThat(summary.changeSet().changes())
                .extracting(ResolvedChangeSet.PersonChange::kind, ResolvedChangeSet.PersonChange::externalId)
                .containsExactlyInAnyOrder(tuple(ResolvedChangeSet.ChangeKind.CREATE, "4711"),
                        tuple(ResolvedChangeSet.ChangeKind.CREATE, "4712"));
        assertThat(stored).as("the stored preview keeps the count of a left-out row and nothing of it")
                .doesNotContain("4713", "Mary", "Major", "Peter", "Poe", "Sam", "Sample");
        assertThat(outcome.created()).isEqualTo(2);
        assertThat(persons.count() - peopleBefore).isEqualTo(2);
        assertThat(personIdsOf(source)).containsOnlyKeys("4711", "4712");
    }

    @Test
    void givenAMemberWhoseCategoryChangesToALeftOutValue_whenTheNextFullSnapshotRuns_thenTheirMembershipEnds() {
        // given
        executions.execute(preview(FULL_EXPORT, SnapshotMode.FULL_SNAPSHOT).previewId(), false, actor);
        UUID john = personIdsOf(source).get("4712");
        assertThat(accountOf(john).isEnabled()).as("the import opened John's sign-in").isTrue();

        // when
        PreviewSummary next = preview(FULL_EXPORT.replace("4712,John,Roe,john.roe@example.org,active",
                "4712,John,Roe,john.roe@example.org,resigned"), SnapshotMode.FULL_SNAPSHOT);
        RunOutcome outcome = executions.execute(next.previewId(), true, actor);

        // then
        assertThat(next.leftOutRows()).isEqualTo(Map.of("resigned", 3, "deceased", 1));
        assertThat(next.changeSet().changes())
                .extracting(ResolvedChangeSet.PersonChange::kind, ResolvedChangeSet.PersonChange::personId)
                .containsExactly(tuple(ResolvedChangeSet.ChangeKind.END_MEMBERSHIP, john));
        assertThat(next.changeSet().removals())
                .as("a left-out member counts towards the removal warning like a missing one")
                .isEqualTo(new ResolvedChangeSet.RemovalCounts(1, 2, 50));
        assertThat(next.needsConfirmation()).isTrue();
        assertThat(outcome.membershipsEnded()).isEqualTo(1);
        assertThat(outcome.accountsDisabled()).isEqualTo(1);
        assertThat(members.findByPersonIdOrderByStartedOnAscIdAsc(john)).singleElement()
                .satisfies(member -> assertThat(member.getEndedOn()).isNotNull());
        assertThat(accountOf(john).isEnabled()).as("an account holding only MEMBER is disabled").isFalse();
    }

    @Test
    void givenAMemberWhoseCategoryChangesToALeftOutValue_whenTheFileIsOnlyAnUpdate_thenTheirMembershipStays() {
        // given
        executions.execute(preview(FULL_EXPORT, SnapshotMode.FULL_SNAPSHOT).previewId(), false, actor);

        // when
        PreviewSummary next = preview(FULL_EXPORT.replace("4712,John,Roe,john.roe@example.org,active",
                "4712,John,Roe,john.roe@example.org,resigned"), SnapshotMode.UPDATE_ONLY);

        // then
        assertThat(next.changeSet().changes()).as("an update ends nobody, missing or left out").isEmpty();
        assertThat(next.leftOutRows()).containsEntry("resigned", 3);
    }

    @Test
    void givenACategoryNeitherMappedNorLeftOut_whenPreviewing_thenTheSnapshotIsStillRefused() {
        // given
        String export = FULL_EXPORT + "4714,Richard,Roe,richard.roe@example.org,suspended\n";

        // when / then
        assertThatThrownBy(() -> preview(export, SnapshotMode.FULL_SNAPSHOT))
                .isInstanceOf(SnapshotBlockedException.class)
                .satisfies(failure -> {
                    SnapshotBlockedException refused = (SnapshotBlockedException) failure;
                    assertThat(refused.getCode()).isEqualTo("import.snapshot.membershipType.unmapped");
                    assertThat(refused.getParams()).containsEntry("values", List.of("suspended"));
                });
    }

    private PreviewSummary preview(String content, SnapshotMode mode) {
        return previews.create(source, mode, "UTF-8",
                new SnapshotUpload("members.csv", "text/csv", content.getBytes(StandardCharsets.UTF_8)), actor);
    }

    private UserAccount accountOf(UUID personId) {
        return accounts.findAll().stream()
                .filter(account -> personId.equals(account.getPerson().getId()))
                .findFirst().orElseThrow();
    }

    private Map<String, UUID> personIdsOf(UUID sourceId) {
        return references.list(sourceId, null, 50).items().stream()
                .collect(Collectors.toMap(ExternalLink::externalId, ExternalLink::personId));
    }
}
