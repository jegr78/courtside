package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.internal.ImportPreview;
import org.courtside.dataexchange.internal.ImportPreviewRepository;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({IdentityTestFixture.class, MemberTestFixture.class})
class PreviewRetentionTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String TWO_ROWS = """
            Member number,First name,Last name,Email
            4711,Janet,Doe,jane.doe@example.org
            4712,John,Roe,john.roe@example.org
            """;

    @Autowired
    private PreviewService previews;

    @Autowired
    private ImportPreviewRepository stored;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private ExternalReferenceService references;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private Clock clock;

    private UUID source;

    private UUID account;

    @BeforeEach
    void setUp() {
        source = sources.create("roster-system", "Membership system", ",", "UTF-8",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), MEMBERSHIP_TYPE_ID,
                Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME), 10).sourceId();
        UUID admin = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        account = identity.createAccount(admin, "admin", Set.of(Role.ADMIN));
    }

    @Test
    void givenAPreviewPastItsRetention_whenReadingIt_thenTheCountsRemainAndTheChangeSetIsGone() {
        // given
        ImportPreview taken = stored.findById(takePreview()).orElseThrow();
        UUID expiredId = stored.save(expiredCopyOf(taken)).getId();

        // when
        PreviewSummary summary = previews.read(expiredId);

        // then
        assertThat(summary.changeSet()).isNull();
        assertThat(summary.ignoredColumns()).isEmpty();
        assertThat(summary.fileHash()).isEqualTo(taken.getFileHash());
        assertThat(summary.rowCount()).isEqualTo(2);
    }

    @Test
    void whenAPreviewIsTaken_thenItFingerprintsOnlyThePeopleItsChangeSetNames() {
        // given
        UUID renamed = memberLinkedAs("4711", "Jane", "Doe");
        UUID untouched = memberLinkedAs("4712", "John", "Roe");

        // when
        String fingerprints = stored.findById(takePreview()).orElseThrow().getFingerprints();

        // then
        assertThat(fingerprints).contains(renamed.toString());
        assertThat(fingerprints).doesNotContain(untouched.toString());
    }

    private UUID takePreview() {
        return previews.create(source, SnapshotMode.FULL_SNAPSHOT, "UTF-8", "roster.csv",
                TWO_ROWS.getBytes(StandardCharsets.UTF_8), account).previewId();
    }

    private ImportPreview expiredCopyOf(ImportPreview preview) {
        return new ImportPreview(preview.getSourceId(), preview.getMode(), preview.getFileName(),
                preview.getFileHash(), preview.getRowCount(), preview.getChangeSet(),
                preview.getFingerprints(), preview.getRemovalCount(), preview.getRemovalPercent(),
                preview.getRemovalWarningPercent(), clock.instant().minus(Duration.ofDays(30)),
                preview.getCreatedByAccountId(), clock.instant().minus(Duration.ofDays(23)));
    }

    private UUID memberLinkedAs(String externalId, String firstName, String lastName) {
        UUID personId = identity.createPerson(firstName, lastName,
                firstName.toLowerCase() + "." + lastName.toLowerCase() + "@example.org");
        members.assignMembership(personId, MEMBERSHIP_TYPE_ID);
        references.link(source, externalId, personId);
        return personId;
    }
}
