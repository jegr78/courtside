package org.courtside.shared;

import org.courtside.TestCertificate;
import org.courtside.TestPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.postgresql.util.PSQLException;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DatabaseIdentityLifecycleTest {

    private static TestCertificate served;
    private static PostgreSQLContainer database;

    @TempDir
    private Path temporaryDirectory;

    @BeforeAll
    static void startDatabaseWithTls() throws Exception {
        served = TestCertificate.issuedFor("localhost");
        database = TestPostgres.serving(served);
        database.start();
    }

    @AfterAll
    static void stopDatabase() {
        database.stop();
    }

    @Test
    void givenVerifiedBoundedIdentities_whenUpgradingAndRestoring_thenStateAndReplacementSurvive()
            throws Exception {
        // given
        Map<String, String> source = environment(database.getJdbcUrl(), "runtime-retired");
        DatabaseProvisioning.provision(source);
        DatabaseMigration.migrate(migrationEnvironment(source), "43");
        updateClubName(source, "Upgrade and restore club");

        // when
        DatabaseMigration.migrate(migrationEnvironment(source));
        assertThat(value(source, "SELECT to_regclass('public.spring_session')"))
                .isEqualTo("spring_session");
        assertThat(value(source, "SELECT club_name FROM club_config"))
                .isEqualTo("Upgrade and restore club");
        assertThat(value(source, "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()"))
                .isEqualTo("t");
        assertThat(database.execInContainer("pg_dump", "-Fc", "--no-owner", "-U",
                database.getUsername(), "-f", "/tmp/courtside.dump", database.getDatabaseName())
                .getExitCode()).isZero();

        Map<String, String> replacement = environment(database.getJdbcUrl(), "runtime-current");
        DatabaseProvisioning.provision(replacement);
        assertThat(database.execInContainer("createdb", "-U", database.getUsername(), "restored")
                .getExitCode()).isZero();
        assertThat(database.execInContainer("pg_restore", "--no-owner", "--exit-on-error", "-U",
                database.getUsername(), "-d", "restored", "/tmp/courtside.dump").getExitCode()).isZero();
        Map<String, String> restored = environment(jdbcUrlFor("restored"), "runtime-current");
        DatabaseProvisioning.provision(restored);
        DatabaseMigration.migrate(migrationEnvironment(restored));

        // then
        assertThat(value(restored, "SELECT club_name FROM club_config"))
                .isEqualTo("Upgrade and restore club");
        assertThat(value(restored, "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()"))
                .isEqualTo("t");
        assertThatThrownBy(() -> runtimeConnection(restored, "runtime-retired"))
                .isInstanceOf(PSQLException.class);
        try (var connection = runtimeConnection(restored, "runtime-current")) {
            assertThat(connection.isValid(2)).isTrue();
        }
    }

    private Map<String, String> environment(String url, String runtimePassword) throws Exception {
        Map<String, String> environment = new HashMap<>();
        environment.put("SPRING_DATASOURCE_URL", url);
        environment.put("COURTSIDE_DB_OWNER_USERNAME", database.getUsername());
        environment.put("COURTSIDE_DB_OWNER_PASSWORD_FILE",
                secret("owner-password", database.getPassword()).toString());
        environment.put("COURTSIDE_DB_MIGRATION_USERNAME", "courtside_migration");
        environment.put("COURTSIDE_DB_MIGRATION_PASSWORD_FILE",
                secret("migration-password", "migration-secret").toString());
        environment.put("COURTSIDE_DB_RUNTIME_USERNAME", "courtside_runtime");
        environment.put("COURTSIDE_DB_RUNTIME_PASSWORD_FILE",
                secret("runtime-password", runtimePassword).toString());
        environment.put("COURTSIDE_DB_TLS_MODE", "verify-full");
        environment.put("COURTSIDE_DB_TLS_ROOT_CERTIFICATE",
                secret("authority.pem", served.authority()).toString());
        return environment;
    }

    private Map<String, String> migrationEnvironment(Map<String, String> identities) {
        Map<String, String> migration = new HashMap<>();
        for (String key : new String[]{"SPRING_DATASOURCE_URL", "COURTSIDE_DB_MIGRATION_USERNAME",
                "COURTSIDE_DB_MIGRATION_PASSWORD_FILE", "COURTSIDE_DB_TLS_MODE",
                "COURTSIDE_DB_TLS_ROOT_CERTIFICATE"}) {
            migration.put(key, identities.get(key));
        }
        return migration;
    }

    private void updateClubName(Map<String, String> environment, String name) throws Exception {
        try (var connection = runtimeConnection(environment, "runtime-retired");
                var statement = connection.prepareStatement("UPDATE club_config SET club_name = ?")) {
            statement.setString(1, name);
            assertThat(statement.executeUpdate()).isOne();
        }
    }

    private String value(Map<String, String> environment, String sql) throws Exception {
        try (var connection = runtimeConnection(environment,
                DatabaseSecretFile.read("runtime", environment.get("COURTSIDE_DB_RUNTIME_PASSWORD_FILE")));
                var statement = connection.createStatement();
                var result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            return result.getString(1);
        }
    }

    private java.sql.Connection runtimeConnection(Map<String, String> environment, String password)
            throws Exception {
        Properties properties = new Properties();
        properties.setProperty("user", environment.get("COURTSIDE_DB_RUNTIME_USERNAME"));
        properties.setProperty("password", password);
        properties.setProperty("sslmode", "verify-full");
        properties.setProperty("sslrootcert", environment.get("COURTSIDE_DB_TLS_ROOT_CERTIFICATE"));
        return DriverManager.getConnection(environment.get("SPRING_DATASOURCE_URL"), properties);
    }

    private String jdbcUrlFor(String name) {
        return database.getJdbcUrl().replace("/" + database.getDatabaseName() + "?", "/" + name + "?");
    }

    private Path secret(String name, String value) throws Exception {
        Path file = temporaryDirectory.resolve(name);
        return Files.writeString(file, value.endsWith("\n") ? value : value + "\n");
    }
}
