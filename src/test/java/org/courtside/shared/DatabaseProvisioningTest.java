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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
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
    void givenAnOwnerThatIsNoSuperuser_whenIdentitiesAreProvisionedTwice_thenRuntimeReadsWhatMigrationWrote()
            throws Exception {
        // given
        asSuperuser("CREATE ROLE club_owner LOGIN CREATEROLE NOINHERIT PASSWORD 'owner-secret'",
                "CREATE DATABASE club OWNER club_owner");
        Map<String, String> environment = ownedEnvironment("club", "club-runtime-secret");

        // when
        DatabaseProvisioning.provision(environment);
        DatabaseMigration.migrate(migrationEnvironment(environment));
        DatabaseProvisioning.provision(environment);

        // then
        try (var connection = DriverManager.getConnection(databaseUrl("club"), "club_runtime", "club-runtime-secret");
                var statement = connection.createStatement()) {
            assertThat(statement.executeQuery("SELECT COUNT(*) FROM court"))
                    .satisfies(result -> assertThat(result.next()).isTrue());
            assertThat(statement.executeQuery(
                    "SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname = 'btree_gist'"))
                    .satisfies(result -> {
                        assertThat(result.next()).isTrue();
                        assertThat(result.getString(1)).isEqualTo("public");
                    });
            assertThatThrownBy(() -> statement.execute("CREATE TABLE forbidden(id integer)"))
                    .isInstanceOf(PSQLException.class)
                    .hasMessageContaining("permission denied");
        }
    }

    @Test
    void givenRolesAnotherRoleCreated_whenAnOwnerThatIsNoSuperuserProvisions_thenItRefusesAndChangesNothing()
            throws Exception {
        // given
        asSuperuser("CREATE ROLE adopted_owner LOGIN CREATEROLE PASSWORD 'owner-secret'",
                "CREATE DATABASE adopted OWNER adopted_owner",
                "CREATE ROLE adopted_migration LOGIN PASSWORD 'migration-before'",
                "CREATE ROLE adopted_runtime LOGIN PASSWORD 'runtime-before'",
                "GRANT adopted_migration TO adopted_owner WITH ADMIN OPTION");
        Map<String, String> environment = ownedEnvironment("adopted", "adopted-runtime-after");
        environment.put("COURTSIDE_DB_MIGRATION_PASSWORD_FILE",
                secret("adopted-migration", "adopted-migration-after").toString());

        // when / then
        assertThatThrownBy(() -> DatabaseProvisioning.provision(environment))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("refused the owner role")
                .satisfies(failure -> assertThat(((DatabaseIdentityConfigurationException) failure).action())
                        .contains("ADMIN OPTION"));
        try (var migration = DriverManager.getConnection(
                databaseUrl("adopted"), "adopted_migration", "migration-before");
                var runtime = DriverManager.getConnection(
                        databaseUrl("adopted"), "adopted_runtime", "runtime-before")) {
            assertThat(migration.isValid(2)).isTrue();
            assertThat(runtime.isValid(2)).isTrue();
        }
        assertThat(DATABASE.getLogs())
                .doesNotContain("adopted-migration-after")
                .doesNotContain("adopted-runtime-after");
    }

    @Test
    void givenARuntimeRoleThatBypassesRowSecurity_whenAnOwnerLackingItProvisions_thenItRefusesAndTheAttributeStays()
            throws Exception {
        // given
        asSuperuser("CREATE ROLE bypass_owner LOGIN CREATEROLE PASSWORD 'owner-secret'",
                "CREATE DATABASE bypass OWNER bypass_owner",
                "CREATE ROLE bypass_runtime LOGIN BYPASSRLS PASSWORD 'unused'",
                "GRANT bypass_runtime TO bypass_owner WITH ADMIN OPTION");
        Map<String, String> environment = ownedEnvironment("bypass", "runtime-any");

        // when / then
        assertThatThrownBy(() -> DatabaseProvisioning.provision(environment))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("refused the owner role");
        assertThat(attributes("bypass_runtime")).containsEntry("rolbypassrls", true);
        assertThat(roleExists("bypass_migration")).isFalse();
    }

    @Test
    void givenAMembershipAnotherRoleGranted_whenAnOwnerThatIsNoSuperuserProvisions_thenItRefusesAndTheMembershipStays()
            throws Exception {
        // given
        asSuperuser("CREATE ROLE granted_owner LOGIN CREATEROLE PASSWORD 'owner-secret'",
                "CREATE DATABASE granted OWNER granted_owner",
                "CREATE ROLE granted_migration LOGIN PASSWORD 'unused'",
                "CREATE ROLE granted_runtime LOGIN PASSWORD 'unused'",
                "GRANT granted_migration, granted_runtime TO granted_owner WITH ADMIN OPTION",
                "GRANT granted_migration TO granted_runtime");
        Map<String, String> environment = ownedEnvironment("granted", "runtime-any");

        // when / then
        assertThatThrownBy(() -> DatabaseProvisioning.provision(environment))
                .isInstanceOf(DatabaseIdentityConfigurationException.class)
                .hasMessageContaining("refused the owner role");
        assertThat(memberships("granted_runtime")).containsExactly("granted_migration");
    }

    @Test
    void givenAMembershipAnotherRoleGranted_whenASuperuserProvisions_thenTheMembershipIsRemoved() throws Exception {
        // given
        asSuperuser("CREATE DATABASE revoked",
                "CREATE ROLE revoked_grantor LOGIN CREATEROLE PASSWORD 'unused'",
                "CREATE ROLE revoked_migration LOGIN PASSWORD 'unused'",
                "CREATE ROLE revoked_runtime LOGIN PASSWORD 'unused'",
                "GRANT revoked_migration TO revoked_grantor WITH ADMIN OPTION",
                "SET ROLE revoked_grantor",
                "GRANT revoked_migration TO revoked_runtime",
                "RESET ROLE");
        Map<String, String> environment = identityEnvironment("runtime-revoked");
        environment.put("SPRING_DATASOURCE_URL", databaseUrl("revoked"));
        environment.put("COURTSIDE_DB_MIGRATION_USERNAME", "revoked_migration");
        environment.put("COURTSIDE_DB_RUNTIME_USERNAME", "revoked_runtime");

        // when
        DatabaseProvisioning.provision(environment);

        // then
        assertThat(memberships("revoked_runtime")).isEmpty();
    }

    @Test
    void givenAnOwnerWhoseStatementsAreLogged_whenIdentitiesAreProvisioned_thenNoPasswordReachesTheLog()
            throws Exception {
        // given
        asSuperuser("CREATE ROLE logged_owner LOGIN CREATEROLE PASSWORD 'owner-secret'",
                "ALTER ROLE logged_owner SET log_statement = 'all'",
                "CREATE DATABASE logged OWNER logged_owner");
        Map<String, String> environment = ownedEnvironment("logged", "logged-runtime-secret");
        environment.put("COURTSIDE_DB_MIGRATION_PASSWORD_FILE",
                secret("logged-migration", "logged-migration-secret").toString());

        // when
        DatabaseProvisioning.provision(environment);

        // then
        assertThat(DATABASE.getLogs()).contains("ALTER ROLE logged_runtime")
                .doesNotContain("logged-runtime-secret").doesNotContain("logged-migration-secret");
        try (var connection = DriverManager.getConnection(
                databaseUrl("logged"), "logged_runtime", "logged-runtime-secret")) {
            assertThat(connection.isValid(2)).isTrue();
        }
    }

    @Test
    void givenARuntimeRoleThatMayCreateDatabases_whenAnOwnerWithThatAttributeProvisions_thenOnlyThatAttributeIsNamed()
            throws Exception {
        // given
        asSuperuser("CREATE ROLE creating_owner LOGIN CREATEROLE CREATEDB PASSWORD 'owner-secret'",
                "CREATE DATABASE creating OWNER creating_owner",
                "CREATE ROLE creating_runtime LOGIN CREATEDB PASSWORD 'unused'",
                "GRANT creating_runtime TO creating_owner WITH ADMIN OPTION");
        Map<String, String> environment = ownedEnvironment("creating", "runtime-any");

        // when
        DatabaseProvisioning.provision(environment);

        // then
        assertThat(attributes("creating_runtime")).containsEntry("rolcreatedb", false);
    }

    @Test
    void givenABoundedRoleWithEveryAttribute_whenASuperuserProvisionsIt_thenEveryAttributeIsRemoved()
            throws Exception {
        // given
        asSuperuser("CREATE DATABASE attributed",
                "CREATE ROLE attributed_runtime LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS INHERIT "
                        + "PASSWORD 'unused'");
        Map<String, String> environment = identityEnvironment("runtime-attributed");
        environment.put("SPRING_DATASOURCE_URL", databaseUrl("attributed"));
        environment.put("COURTSIDE_DB_MIGRATION_USERNAME", "attributed_migration");
        environment.put("COURTSIDE_DB_RUNTIME_USERNAME", "attributed_runtime");

        // when
        DatabaseProvisioning.provision(environment);

        // then
        assertThat(attributes("attributed_runtime")).containsOnly(
                Map.entry("rolsuper", false), Map.entry("rolcreatedb", false), Map.entry("rolcreaterole", false),
                Map.entry("rolreplication", false), Map.entry("rolbypassrls", false), Map.entry("rolinherit", false));
    }

    @Test
    void givenAnOperatorPlantedByMigration_whenSetupRunsAgain_thenTheOwnerNeverCallsIt() throws Exception {
        // given
        asSuperuser("CREATE DATABASE planted");
        Map<String, String> environment = identityEnvironment("runtime-planted");
        environment.put("SPRING_DATASOURCE_URL", databaseUrl("planted"));
        environment.put("COURTSIDE_DB_MIGRATION_USERNAME", "planted_migration");
        environment.put("COURTSIDE_DB_RUNTIME_USERNAME", "planted_runtime");
        DatabaseProvisioning.provision(environment);
        try (var connection = DriverManager.getConnection(
                databaseUrl("planted"), "planted_migration", "migration-secret");
                var statement = connection.createStatement()) {
            statement.execute("CREATE TABLE planted_call(caller name)");
            statement.execute("CREATE FUNCTION planted_equal(name, varchar) RETURNS boolean LANGUAGE sql AS "
                    + "'INSERT INTO planted_call VALUES (current_user); SELECT $1::text = $2::text'");
            statement.execute("CREATE OPERATOR public.= (LEFTARG = name, RIGHTARG = varchar, "
                    + "FUNCTION = planted_equal)");
        }

        // when
        DatabaseProvisioning.provision(environment);

        // then
        try (var connection = DriverManager.getConnection(
                databaseUrl("planted"), DATABASE.getUsername(), DATABASE.getPassword());
                var statement = connection.createStatement();
                var result = statement.executeQuery("SELECT COUNT(*) FROM public.planted_call")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getLong(1)).isZero();
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

    private void asSuperuser(String... statements) throws Exception {
        try (var connection = DriverManager.getConnection(
                DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
                var statement = connection.createStatement()) {
            for (String sql : statements) {
                statement.execute(sql);
            }
        }
    }

    private Map<String, Boolean> attributes(String role) throws Exception {
        try (var connection = DriverManager.getConnection(
                DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
                var statement = connection.prepareStatement("SELECT rolsuper, rolcreatedb, rolcreaterole, "
                        + "rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = ?")) {
            statement.setString(1, role);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                Map<String, Boolean> attributes = new HashMap<>();
                for (int column = 1; column <= result.getMetaData().getColumnCount(); column++) {
                    attributes.put(result.getMetaData().getColumnName(column), result.getBoolean(column));
                }
                return attributes;
            }
        }
    }

    private boolean roleExists(String role) throws Exception {
        try (var connection = DriverManager.getConnection(
                DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
                var statement = connection.prepareStatement("SELECT FROM pg_roles WHERE rolname = ?")) {
            statement.setString(1, role);
            try (var result = statement.executeQuery()) {
                return result.next();
            }
        }
    }

    private List<String> memberships(String member) throws Exception {
        try (var connection = DriverManager.getConnection(
                DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
                var statement = connection.prepareStatement("SELECT granted.rolname FROM pg_auth_members membership "
                        + "JOIN pg_roles granted ON granted.oid = membership.roleid "
                        + "JOIN pg_roles grantee ON grantee.oid = membership.member WHERE grantee.rolname = ?")) {
            statement.setString(1, member);
            try (var result = statement.executeQuery()) {
                List<String> granted = new ArrayList<>();
                while (result.next()) {
                    granted.add(result.getString(1));
                }
                return granted;
            }
        }
    }

    private String databaseUrl(String name) {
        return DATABASE.getJdbcUrl().replace("/" + DATABASE.getDatabaseName() + "?", "/" + name + "?");
    }

    private Map<String, String> ownedEnvironment(String database, String runtimePassword) throws Exception {
        Map<String, String> environment = identityEnvironment(runtimePassword);
        environment.put("SPRING_DATASOURCE_URL", databaseUrl(database));
        environment.put("COURTSIDE_DB_OWNER_USERNAME", database + "_owner");
        environment.put("COURTSIDE_DB_OWNER_PASSWORD_FILE", secret(database + "-owner", "owner-secret").toString());
        environment.put("COURTSIDE_DB_MIGRATION_USERNAME", database + "_migration");
        environment.put("COURTSIDE_DB_RUNTIME_USERNAME", database + "_runtime");
        return environment;
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
