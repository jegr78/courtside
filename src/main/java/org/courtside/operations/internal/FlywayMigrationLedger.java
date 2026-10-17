package org.courtside.operations.internal;

import lombok.RequiredArgsConstructor;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationInfoService;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

// Reads the history the migration process wrote; the application itself may not migrate.
@Component
@RequiredArgsConstructor
class FlywayMigrationLedger implements MigrationLedger {

    private final DataSource dataSource;

    @Override
    public Snapshot read() {
        MigrationInfoService info = Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .info();
        MigrationInfo current = info.current();
        List<String> pending = Arrays.stream(info.pending()).map(MigrationInfo::getVersion)
                .map(Object::toString).toList();
        Optional<String> failed = Arrays.stream(info.all()).filter(migration -> migration.getState().isFailed())
                .map(migration -> migration.getVersion().toString()).findFirst();
        Optional<String> expected = Arrays.stream(info.all())
                .filter(migration -> migration.getState().isResolved())
                .map(MigrationInfo::getVersion)
                .max(Comparator.naturalOrder())
                .map(Object::toString);
        return new Snapshot(current == null ? null : current.getVersion().toString(), expected.orElse(null),
                pending, failed);
    }
}
