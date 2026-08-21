package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.internal.ImportPreviewRepository;
import org.courtside.dataexchange.internal.PreviewExpiry;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccountRepository;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class PreviewExpiryTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String ONE_MEMBER = """
            Member number,First name,Last name,Email
            4711,Jane,Doe,jane.doe@example.org
            """;

    @Autowired
    private PreviewService previews;

    @Autowired
    private ExecutionService executions;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private ImportPreviewRepository stored;

    @Autowired
    private PreviewExpiry expiry;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private Clock clock;

    private UUID source;
    private UUID actor;

    @BeforeEach
    void setUp() {
        source = sources.create("roster-system", "Membership system", ",", "UTF-8",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), ACTIVE_TYPE, Set.of(CanonicalField.FIRST_NAME), 10).sourceId();
        UUID admin = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        actor = identity.createAccount(admin, "admin", Set.of(Role.ADMIN));
    }

    @Test
    void givenAPreviewInsideItsRetention_whenTheSweepRuns_thenItIsLeftWhole() {
        // given
        UUID previewId = preview();

        // when
        int swept = expiry.sweep(clock.instant());

        // then
        assertThat(swept).isZero();
        assertThat(previews.read(previewId).changeSet()).isNotNull();
        assertThat(stored.findById(previewId).orElseThrow().getFingerprints()).isNotNull();
    }

    @Test
    void givenAPreviewPastItsRetention_whenTheSweepRuns_thenOnlyItsPersonalDataIsDropped() {
        // given
        UUID previewId = preview();
        PreviewSummary before = previews.read(previewId);

        // when
        int swept = expiry.sweep(clock.instant().plus(Duration.ofDays(8)));

        // then
        assertThat(swept).isEqualTo(1);
        PreviewSummary after = previews.read(previewId);
        assertThat(after.changeSet()).isNull();
        assertThat(after.fileHash()).isEqualTo(before.fileHash());
        assertThat(after.rowCount()).isEqualTo(before.rowCount());
        assertThat(stored.findById(previewId).orElseThrow().getFingerprints()).isNull();
    }

    @Test
    void givenASweptPreview_whenExecutingIt_thenItIsRefusedRatherThanRunningOnNothing() {
        // given
        UUID previewId = preview();
        expiry.sweep(clock.instant().plus(Duration.ofDays(8)));

        // when / then
        assertThatThrownBy(() -> executions.execute(previewId, false, actor))
                .isInstanceOf(ImportPreviewExpiredException.class);
        assertThat(persons.count()).isEqualTo(1);
    }

    @Test
    void givenASweptPreview_whenAnotherUploadSupersedesIt_thenWhatWasDroppedStaysDropped() {
        // given
        UUID previewId = preview();
        expiry.sweep(clock.instant().plus(Duration.ofDays(9)));

        // when
        previews.create(source, SnapshotMode.FULL_SNAPSHOT, "UTF-8", "roster.csv",
                ONE_MEMBER.getBytes(StandardCharsets.UTF_8), actor);

        // then
        assertThat(stored.findById(previewId).orElseThrow().getChangeSet()).isNull();
        assertThat(stored.findById(previewId).orElseThrow().getFingerprints()).isNull();
        assertThat(stored.findById(previewId).orElseThrow().isSuperseded()).isTrue();
    }

    @Test
    void givenASweptPreview_whenTheSweepRunsAgain_thenThereIsNothingLeftToDrop() {
        // given
        preview();
        expiry.sweep(clock.instant().plus(Duration.ofDays(8)));

        // when / then
        assertThat(expiry.sweep(clock.instant().plus(Duration.ofDays(9)))).isZero();
    }

    @Test
    void whenTheScheduledSweepRuns_thenItUsesTheClockAndLeavesAFreshPreviewAlone() {
        // given
        UUID previewId = preview();

        // when
        expiry.sweepNow();

        // then
        assertThat(previews.read(previewId).changeSet()).isNotNull();
    }

    private UUID preview() {
        return previews.create(source, SnapshotMode.FULL_SNAPSHOT, "UTF-8", "roster.csv",
                ONE_MEMBER.getBytes(StandardCharsets.UTF_8), actor).previewId();
    }
}
