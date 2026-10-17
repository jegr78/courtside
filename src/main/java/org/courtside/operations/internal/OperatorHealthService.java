package org.courtside.operations.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.notification.MailHandover;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.info.BuildProperties;
import org.springframework.boot.info.GitProperties;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;

@Slf4j
@Service
public class OperatorHealthService {

    private final BuildProperties build;
    private final @Nullable GitProperties git;
    private final MigrationLedger migrations;
    private final MailHandover mail;
    private final BackupEvidence backup;
    private final Clock clock;
    private final String publicUrl;

    OperatorHealthService(BuildProperties build,
                          // Absent when the build had no repository to read.
                          @Nullable GitProperties git,
                          MigrationLedger migrations, MailHandover mail, BackupEvidence backup, Clock clock,
                          @Value("${courtside.public-url:}") String publicUrl) {
        this.build = build;
        this.git = git;
        this.migrations = migrations;
        this.mail = mail;
        this.backup = backup;
        this.clock = clock;
        this.publicUrl = publicUrl == null ? "" : publicUrl.strip();
    }

    public OperatorHealth read() {
        Instant now = clock.instant();
        return new OperatorHealth(now, version(), migrations(), mail(), publicOrigin(), backup.evaluate(now));
    }

    OperatorHealth.Backup backup() {
        return backup.evaluate(clock.instant());
    }

    private OperatorHealth.Version version() {
        return new OperatorHealth.Version(build.getVersion(), git == null ? null : git.getCommitId(),
                build.getTime());
    }

    private OperatorHealth.Migrations migrations() {
        MigrationLedger.Snapshot snapshot;
        try {
            snapshot = migrations.read();
        } catch (RuntimeException unreadable) {
            log.warn("The migration history could not be read", unreadable);
            return new OperatorHealth.Migrations(CheckState.UNAVAILABLE, CheckReason.UNREADABLE, null, null, 0, null);
        }
        int pending = snapshot.pending().size();
        if (snapshot.failed().isPresent()) {
            return new OperatorHealth.Migrations(CheckState.FAILING, CheckReason.FAILED_MIGRATION,
                    snapshot.currentVersion(), snapshot.expectedVersion(), pending, snapshot.failed().get());
        }
        if (pending > 0) {
            return new OperatorHealth.Migrations(CheckState.FAILING, CheckReason.PENDING_MIGRATIONS,
                    snapshot.currentVersion(), snapshot.expectedVersion(), pending, snapshot.pending().getFirst());
        }
        return new OperatorHealth.Migrations(CheckState.OK, null, snapshot.currentVersion(),
                snapshot.expectedVersion(), 0, null);
    }

    private OperatorHealth.Mail mail() {
        MailHandover.Observation observed = mail.observe();
        Instant handedOver = observed.lastHandedOverAt().orElse(null);
        if (observed.retrying()) {
            return new OperatorHealth.Mail(CheckState.FAILING, CheckReason.HANDOVER_FAILING, handedOver,
                    observed.relay());
        }
        if (observed.lastFailedAt().isPresent()
                && (handedOver == null || observed.lastFailedAt().get().isAfter(handedOver))) {
            return new OperatorHealth.Mail(CheckState.FAILING, CheckReason.LAST_MESSAGE_FAILED, handedOver,
                    observed.relay());
        }
        if (handedOver == null) {
            return new OperatorHealth.Mail(CheckState.UNAVAILABLE, CheckReason.NOT_YET_OBSERVED, null, null);
        }
        return new OperatorHealth.Mail(CheckState.OK, null, handedOver, null);
    }

    private OperatorHealth.PublicOrigin publicOrigin() {
        if (publicUrl.isEmpty()) {
            return new OperatorHealth.PublicOrigin(CheckState.UNAVAILABLE, CheckReason.NOT_CONFIGURED, null);
        }
        return new OperatorHealth.PublicOrigin(CheckState.OK, null,
                publicUrl.endsWith("/") ? publicUrl.substring(0, publicUrl.length() - 1) : publicUrl);
    }
}
