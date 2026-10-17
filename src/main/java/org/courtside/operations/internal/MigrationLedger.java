package org.courtside.operations.internal;

import org.jspecify.annotations.Nullable;

import java.util.List;
import java.util.Optional;

interface MigrationLedger {

    record Snapshot(@Nullable String currentVersion, @Nullable String expectedVersion, List<String> pending,
                    Optional<String> failed) {
    }

    Snapshot read();
}
