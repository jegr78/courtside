package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.internal.ImportPreview;
import org.courtside.dataexchange.internal.ImportPreviewRepository;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PreviewRetentionTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String TWO_ROWS = """
            Member number,First name,Last name
            4711,Janet,Doe
            4712,John,Roe
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
    private MemberRepository members;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private Clock clock;

    private UUID source;

    private UUID account;

    @BeforeEach
    void setUp() {
        source = sources.create("roster-system", "Membership system",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME),
                Map.of(), Set.of(CanonicalField.FIRST_NAME, CanonicalField.LAST_NAME), 10).sourceId();
        Person admin = persons.save(new Person("Richard", "Miles", "richard.miles@example.org"));
        account = accounts.save(new UserAccount(admin, "admin", "hash", Set.of(Role.ADMIN))).getId();
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
        return previews.create(source, SnapshotMode.FULL_SNAPSHOT, "roster.csv",
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
        UUID personId = persons.save(new Person(firstName, lastName,
                firstName.toLowerCase() + "." + lastName.toLowerCase() + "@example.org")).getId();
        members.save(new Member(personId, MEMBERSHIP_TYPE_ID, LocalDate.of(2026, 1, 1)));
        references.link(source, externalId, personId);
        return personId;
    }
}
