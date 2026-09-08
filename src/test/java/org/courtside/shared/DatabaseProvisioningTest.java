package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.postgresql.util.PSQLException;
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
class DatabaseProvisioningTest {

    @Container
    private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:17-alpine");

    @TempDir
    private Path temporaryDirectory;

    @Test
    void givenTheSetupCommandAmongOtherArguments_whenItIsSelected_thenOnlyTheExactCommandMatches() {
        // when / then
        assertThat(DatabaseProvisioning.requested(new String[]{"--courtside-database-setup"})).isTrue();
        assertThat(DatabaseProvisioning.requested(
                new String[]{"--courtside-database-setup", "--server.port=0"})).isFalse();
        assertThat(DatabaseProvisioning.requested(new String[]{"--server.port=0"})).isFalse();
    }

    @Test
    void givenSeparateDatabaseIdentities_whenTheyAreProvisioned_thenRuntimeCannotChangeAuthority()
            throws Exception {
        // given
        Map<String, String> environment = identityEnvironment("runtime-one");

        // when
        DatabaseProvisioning.provision(environment);
        DatabaseMigration.migrate(migrationEnvironment(environment));

        // then
        try (var connection = DriverManager.getConnection(
                DATABASE.getJdbcUrl(), "courtside_runtime", "runtime-one");
                var statement = connection.createStatement()) {
            assertThat(statement.executeQuery("SELECT COUNT(*) FROM court"))
                    .satisfies(result -> assertThat(result.next()).isTrue());
            assertThatThrownBy(() -> statement.execute("CREATE TABLE forbidden(id integer)"))
                    .isInstanceOf(PSQLException.class)
                    .hasMessageContaining("permission denied");
            assertThatThrownBy(() -> statement.execute("ALTER ROLE courtside_runtime CREATEDB"))
                    .isInstanceOf(PSQLException.class);
        }
    }

    @Test
    void givenARuntimeSequence_whenPrivilegesAreReconciled_thenItsPositionCannotBeRewritten()
            throws Exception {
        // given
        Map<String, String> environment = identityEnvironment("runtime-sequence");
        DatabaseProvisioning.provision(environment);
        try (var connection = DriverManager.getConnection(
                DATABASE.getJdbcUrl(), "courtside_migration", "migration-secret");
                var statement = connection.createStatement()) {
            statement.execute("CREATE SEQUENCE runtime_sequence_probe");
        }

        // when
        DatabaseProvisioning.provision(environment);

        // then
        try (var connection = DriverManager.getConnection(
                DATABASE.getJdbcUrl(), "courtside_runtime", "runtime-sequence");
                var statement = connection.createStatement()) {
            assertThat(statement.executeQuery("SELECT nextval('runtime_sequence_probe')"))
                    .satisfies(result -> {
                        assertThat(result.next()).isTrue();
                        assertThat(result.getLong(1)).isOne();
                    });
            assertThatThrownBy(() -> statement.execute("SELECT setval('runtime_sequence_probe', 50)"))
                    .isInstanceOf(PSQLException.class)
                    .hasMessageContaining("permission denied");
        }
    }

    @Test
    void givenAReplacementRuntimeSecret_whenProvisioningRunsAgain_thenOnlyTheReplacementWorks()
            throws Exception {
        // given
        Map<String, String> first = identityEnvironment("runtime-old");
        DatabaseProvisioning.provision(first);

        // when
        Map<String, String> replacement = identityEnvironment("runtime-new");
        DatabaseProvisioning.provision(replacement);

        // then
        assertThatThrownBy(() -> DriverManager.getConnection(
                DATABASE.getJdbcUrl(), "courtside_runtime", "runtime-old"))
                .isInstanceOf(PSQLException.class);
        try (var connection = DriverManager.getConnection(
                DATABASE.getJdbcUrl(), "courtside_runtime", "runtime-new")) {
            assertThat(connection.isValid(2)).isTrue();
        }
    }

    @Test
    void givenAStaleOwnerSecret_whenProvisioningRuns_thenItRefusesWithoutPrintingIt()
            throws Exception {
        // given
        Map<String, String> environment = identityEnvironment("runtime-any");
        Path stale = Files.writeString(temporaryDirectory.resolve("stale-owner"), "stale-owner-secret\n");
        environment.put("COURTSIDE_DB_OWNER_PASSWORD_FILE", stale.toString());

        // when / then
        assertThatThrownBy(() -> DatabaseProvisioning.provision(environment))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("setup credential")
                .hasMessageNotContaining("stale-owner-secret");
    }

    @Test
    void givenAnAdministrativeRuntimeRole_whenProvisioningRuns_thenItIsRefusedBeforeItCanBeChanged()
            throws Exception {
        // given
        Map<String, String> environment = identityEnvironment("runtime-any");
        environment.put("COURTSIDE_DB_RUNTIME_USERNAME", "postgres");

        // when / then
        assertThatThrownBy(() -> DatabaseProvisioning.provision(environment))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("administrative role");
    }

    private Map<String, String> identityEnvironment(String runtimePassword) throws Exception {
        Map<String, String> environment = new HashMap<>();
        environment.put("SPRING_DATASOURCE_URL", DATABASE.getJdbcUrl());
        environment.put("COURTSIDE_DB_OWNER_USERNAME", DATABASE.getUsername());
        environment.put("COURTSIDE_DB_OWNER_PASSWORD_FILE",
                secret("owner-password", DATABASE.getPassword()).toString());
        environment.put("COURTSIDE_DB_MIGRATION_USERNAME", "courtside_migration");
        environment.put("COURTSIDE_DB_MIGRATION_PASSWORD_FILE",
                secret("migration-password", "migration-secret").toString());
        environment.put("COURTSIDE_DB_RUNTIME_USERNAME", "courtside_runtime");
        environment.put("COURTSIDE_DB_RUNTIME_PASSWORD_FILE",
                secret("runtime-password", runtimePassword).toString());
        environment.put("COURTSIDE_DB_TLS_MODE", "prefer");
        return environment;
    }

    private Map<String, String> migrationEnvironment(Map<String, String> identities) {
        Map<String, String> migration = new HashMap<>();
        migration.put("SPRING_DATASOURCE_URL", identities.get("SPRING_DATASOURCE_URL"));
        migration.put("COURTSIDE_DB_MIGRATION_USERNAME",
                identities.get("COURTSIDE_DB_MIGRATION_USERNAME"));
        migration.put("COURTSIDE_DB_MIGRATION_PASSWORD_FILE",
                identities.get("COURTSIDE_DB_MIGRATION_PASSWORD_FILE"));
        migration.put("COURTSIDE_DB_TLS_MODE", "prefer");
        return migration;
    }

    private Path secret(String name, String value) throws Exception {
        return Files.writeString(temporaryDirectory.resolve(name), value + "\n");
    }
}
