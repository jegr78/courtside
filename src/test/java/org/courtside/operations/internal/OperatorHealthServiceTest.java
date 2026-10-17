package org.courtside.operations.internal;

import org.courtside.notification.MailHandover;
import org.junit.jupiter.api.Test;
import org.springframework.boot.info.BuildProperties;
import org.springframework.boot.info.GitProperties;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

class OperatorHealthServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-17T09:00:00Z");
    private static final String RELAY = "relay.example.org:587";

    private MigrationLedger.Snapshot migrations = new MigrationLedger.Snapshot("64", "64", List.of(), Optional.empty());
    private MailHandover.Observation mail = new MailHandover.Observation(
            Optional.of(NOW.minusSeconds(60)), Optional.empty(), false, RELAY);
    private String publicUrl = "https://courts.example.org";
    private String backupFile = "";

    private OperatorHealthService service() {
        Properties build = new Properties();
        build.setProperty("version", "0.3.0-rc.1");
        build.setProperty("time", "2026-10-16T20:00:00Z");
        Properties git = new Properties();
        git.setProperty("commit.id", "a".repeat(40));
        return new OperatorHealthService(new BuildProperties(build), new GitProperties(git),
                this::migrationLedger, () -> mail, new BackupEvidence(backupFile),
                Clock.fixed(NOW, ZoneOffset.UTC), publicUrl);
    }

    private MigrationLedger.Snapshot migrationLedger() {
        if (migrations == null) {
            throw new IllegalStateException("permission denied for table flyway_schema_history");
        }
        return migrations;
    }

    @Test
    void givenEveryDependencyAnswers_whenReadingTheOverview_thenEachCheckPassesWithItsEvidence() {
        // when
        OperatorHealth health = service().read();

        // then
        assertThat(health.version()).isEqualTo(new OperatorHealth.Version("0.3.0-rc.1", "a".repeat(40),
                Instant.parse("2026-10-16T20:00:00Z")));
        assertThat(health.migrations().state()).isEqualTo(CheckState.OK);
        assertThat(health.mail().state()).isEqualTo(CheckState.OK);
        assertThat(health.mail().lastHandedOverAt()).isEqualTo(NOW.minusSeconds(60));
        assertThat(health.publicOrigin()).isEqualTo(new OperatorHealth.PublicOrigin(CheckState.OK, null,
                "https://courts.example.org"));
        assertThat(health.checkedAt()).isEqualTo(NOW);
    }

    @Test
    void givenPendingMigrations_whenReadingTheOverview_thenMigrationsFailAtTheFirstPendingVersion() {
        // given
        migrations = new MigrationLedger.Snapshot("62", "64", List.of("63", "64"), Optional.empty());

        // when
        OperatorHealth.Migrations result = service().read().migrations();

        // then
        assertThat(result).isEqualTo(new OperatorHealth.Migrations(CheckState.FAILING,
                CheckReason.PENDING_MIGRATIONS, "62", "64", 2, "63"));
    }

    @Test
    void givenAFailedMigration_whenReadingTheOverview_thenMigrationsFailAtThatVersion() {
        // given
        migrations = new MigrationLedger.Snapshot("63", "64", List.of("64"), Optional.of("64"));

        // when
        OperatorHealth.Migrations result = service().read().migrations();

        // then
        assertThat(result.state()).isEqualTo(CheckState.FAILING);
        assertThat(result.reason()).isEqualTo(CheckReason.FAILED_MIGRATION);
        assertThat(result.location()).isEqualTo("64");
    }

    @Test
    void givenTheMigrationHistoryCannotBeRead_whenReadingTheOverview_thenMigrationsAreUnavailableRatherThanHealthy() {
        // given
        migrations = null;

        // when
        OperatorHealth.Migrations result = service().read().migrations();

        // then
        assertThat(result.state()).isEqualTo(CheckState.UNAVAILABLE);
        assertThat(result.reason()).isEqualTo(CheckReason.UNREADABLE);
    }

    @Test
    void givenTheOutboxIsRetryingAHandover_whenReadingTheOverview_thenMailFailsAtTheRelay() {
        // given
        mail = new MailHandover.Observation(Optional.of(NOW.minusSeconds(3600)), Optional.empty(), true, RELAY);

        // when
        OperatorHealth.Mail result = service().read().mail();

        // then
        assertThat(result.state()).isEqualTo(CheckState.FAILING);
        assertThat(result.reason()).isEqualTo(CheckReason.HANDOVER_FAILING);
        assertThat(result.location()).isEqualTo(RELAY);
    }

    @Test
    void givenTheLastMessageFailedAfterTheLastHandover_whenReadingTheOverview_thenMailFails() {
        // given
        mail = new MailHandover.Observation(Optional.of(NOW.minusSeconds(3600)), Optional.of(NOW.minusSeconds(60)),
                false, RELAY);

        // when
        OperatorHealth.Mail result = service().read().mail();

        // then
        assertThat(result.state()).isEqualTo(CheckState.FAILING);
        assertThat(result.reason()).isEqualTo(CheckReason.LAST_MESSAGE_FAILED);
    }

    @Test
    void givenNoMessageWasEverHandedOver_whenReadingTheOverview_thenMailIsUnavailableRatherThanHealthy() {
        // given
        mail = new MailHandover.Observation(Optional.empty(), Optional.empty(), false, RELAY);

        // when
        OperatorHealth.Mail result = service().read().mail();

        // then
        assertThat(result.state()).isEqualTo(CheckState.UNAVAILABLE);
        assertThat(result.reason()).isEqualTo(CheckReason.NOT_YET_OBSERVED);
    }

    @Test
    void givenNoPublicAddressIsConfigured_whenReadingTheOverview_thenTheOriginIsUnavailable() {
        // given
        publicUrl = "";

        // when
        OperatorHealth.PublicOrigin result = service().read().publicOrigin();

        // then
        assertThat(result).isEqualTo(new OperatorHealth.PublicOrigin(CheckState.UNAVAILABLE,
                CheckReason.NOT_CONFIGURED, null));
    }

    @Test
    void givenNoBackupEvidenceIsConfigured_whenReadingTheOverview_thenTheBackupIsUnavailableRatherThanHealthy() {
        // when
        OperatorHealth.Backup result = service().read().backup();

        // then
        assertThat(result.state()).isEqualTo(CheckState.UNAVAILABLE);
        assertThat(result.reason()).isEqualTo(CheckReason.NOT_CONFIGURED);
    }

    @Test
    void givenTheConfiguredEvidenceFileDoesNotExist_whenReadingTheOverview_thenNoBackupIsRecorded() throws Exception {
        // given
        backupFile = Files.createTempDirectory("backup").resolve("latest.json").toString();

        // when
        OperatorHealth.Backup result = service().read().backup();

        // then
        assertThat(result.state()).isEqualTo(CheckState.UNAVAILABLE);
        assertThat(result.reason()).isEqualTo(CheckReason.NOT_RECORDED);
    }

    @Test
    void givenARecordedBackup_whenReadingTheOverview_thenItsCompletionAndAgeShow() throws Exception {
        // given
        Path file = Files.createTempFile("backup", ".json");
        Files.writeString(file, "{\"completedAt\":\"2026-10-17T03:00:00Z\"}");
        backupFile = file.toString();

        // when
        OperatorHealth.Backup result = service().read().backup();

        // then
        assertThat(result).isEqualTo(new OperatorHealth.Backup(CheckState.OK, null,
                Instant.parse("2026-10-17T03:00:00Z"), 6 * 3600L, null));
    }

    @Test
    void givenAnUnreadableEvidenceFile_whenReadingTheOverview_thenTheBackupFailsNamingTheFile() throws Exception {
        // given
        Path file = Files.createTempFile("backup", ".json");
        Files.writeString(file, "not evidence");
        backupFile = file.toString();

        // when
        OperatorHealth.Backup result = service().read().backup();

        // then
        assertThat(result.state()).isEqualTo(CheckState.FAILING);
        assertThat(result.reason()).isEqualTo(CheckReason.UNREADABLE);
        assertThat(result.location()).isEqualTo(file.toString());
    }

    @Test
    void givenABackupRecordedInTheFuture_whenReadingTheOverview_thenTheBackupFailsRatherThanPassing() throws Exception {
        // given
        Path file = Files.createTempFile("backup", ".json");
        Files.writeString(file, "{\"completedAt\":\"2026-10-18T03:00:00Z\"}");
        backupFile = file.toString();

        // when
        OperatorHealth.Backup result = service().read().backup();

        // then
        assertThat(result.state()).isEqualTo(CheckState.FAILING);
        assertThat(result.reason()).isEqualTo(CheckReason.RECORDED_IN_THE_FUTURE);
    }
}
