package org.courtside.operations.internal;

import org.jspecify.annotations.Nullable;

import java.time.Instant;

public record OperatorHealth(Instant checkedAt, Version version, Migrations migrations, Mail mail,
                             PublicOrigin publicOrigin, Backup backup) {

    public record Version(String version, @Nullable String revision, @Nullable Instant builtAt) {
    }

    public record Migrations(CheckState state, @Nullable CheckReason reason, @Nullable String currentVersion,
                             @Nullable String expectedVersion, int pending, @Nullable String location) {
    }

    public record Mail(CheckState state, @Nullable CheckReason reason, @Nullable Instant lastHandedOverAt,
                       @Nullable String location) {
    }

    public record PublicOrigin(CheckState state, @Nullable CheckReason reason, @Nullable String origin) {
    }

    public record Backup(CheckState state, @Nullable CheckReason reason, @Nullable Instant completedAt,
                         @Nullable Long ageSeconds, @Nullable String location) {
    }
}
