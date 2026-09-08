package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers(disabledWithoutDocker = true)
class DatabaseMigrationTest {

    @Container
    private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:17-alpine");

    @TempDir
    private Path temporaryDirectory;

    @Test
    void givenAMigrationIdentityFile_whenTheMigrationRuns_thenItCreatesTheCompleteSchema()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("migration-password"),
                DATABASE.getPassword() + "\n");
        Map<String, String> environment = migrationEnvironment(password);

        // when
        DatabaseMigration.migrate(environment);

        // then
        try (var connection = DriverManager.getConnection(
                DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
                var statement = connection.createStatement()) {
            assertThat(statement.executeQuery("SELECT count(*) FROM flyway_schema_history "
                    + "WHERE success AND version = '44'"))
                    .satisfies(result -> {
                        assertThat(result.next()).isTrue();
                        assertThat(result.getInt(1)).isOne();
                    });
            assertThat(statement.executeQuery("SELECT to_regclass('public.spring_session')"))
                    .satisfies(result -> {
                        assertThat(result.next()).isTrue();
                        assertThat(result.getString(1)).isEqualTo("spring_session");
                    });
        }
    }

    @Test
    void givenAStaleMigrationSecret_whenTheMigrationRuns_thenItRefusesWithoutPrintingIt()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("stale-password"), "stale-secret\n");

        // when / then
        assertThatThrownBy(() -> DatabaseMigration.migrate(migrationEnvironment(password)))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("migration credential")
                .hasMessageNotContaining("stale-secret");
    }

    @Test
    void givenAUrlPassword_whenTheMigrationRuns_thenItCannotOverrideTheMountedCredential()
            throws Exception {
        // given
        Path password = Files.writeString(temporaryDirectory.resolve("migration-password"),
                DATABASE.getPassword() + "\n");
        Map<String, String> environment = migrationEnvironment(password);
        environment.put("SPRING_DATASOURCE_URL", DATABASE.getJdbcUrl() + "&password=url-secret");

        // when / then
        assertThatThrownBy(() -> DatabaseMigration.migrate(environment))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("connection URL")
                .hasMessageNotContaining("url-secret");
    }

    @Test
    void givenTheMigrationCommandAmongOtherArguments_whenItIsSelected_thenOnlyTheExactCommandMatches() {
        // when / then
        assertThat(DatabaseMigration.requested(new String[]{"--courtside-database-migrate"})).isTrue();
        assertThat(DatabaseMigration.requested(new String[]{"--courtside-database-migrate", "--server.port=0"}))
                .isFalse();
        assertThat(DatabaseMigration.requested(new String[]{"--server.port=0"})).isFalse();
    }

    private Map<String, String> migrationEnvironment(Path password) {
        Map<String, String> environment = new HashMap<>();
        environment.put("SPRING_DATASOURCE_URL", DATABASE.getJdbcUrl());
        environment.put("COURTSIDE_DB_MIGRATION_USERNAME", DATABASE.getUsername());
        environment.put("COURTSIDE_DB_MIGRATION_PASSWORD_FILE", password.toString());
        environment.put("COURTSIDE_DB_TLS_MODE", "prefer");
        return environment;
    }
}
