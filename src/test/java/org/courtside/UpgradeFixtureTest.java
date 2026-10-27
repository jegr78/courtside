package org.courtside;

import org.courtside.shared.DatabaseMigration;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers(disabledWithoutDocker = true)
class UpgradeFixtureTest {

    private static final Path FIXTURE = Path.of("upgrade", "fixtures", "origin.sql");
    private static final Path VERIFICATION = Path.of("upgrade", "verify.sql");

    @Container
    private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>(TestPostgres.deployedImage());

    @BeforeAll
    static void loadTheFixtureOntoTheLatestSchema(@TempDir Path temporaryDirectory) throws Exception {
        Path password = Files.writeString(temporaryDirectory.resolve("migration-password"),
                DATABASE.getPassword() + "\n");
        DatabaseMigration.migrate(Map.of(
                "SPRING_DATASOURCE_URL", DATABASE.getJdbcUrl(),
                "COURTSIDE_DB_MIGRATION_USERNAME", DATABASE.getUsername(),
                "COURTSIDE_DB_MIGRATION_PASSWORD_FILE", password.toString(),
                "COURTSIDE_DB_TLS_MODE", "prefer"));
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            statement.execute("""
                    INSERT INTO person (id, first_name, last_name, email)
                    VALUES ('7f000000-0000-0000-0000-000000000001', 'Jane', 'Doe', 'admin@example.org');
                    INSERT INTO user_account (id, person_id, username, password_hash, locale, enabled)
                    VALUES ('7f000000-0000-0000-0000-000000000002', '7f000000-0000-0000-0000-000000000001',
                            'admin', '{noop}unused', 'en', true);
                    """);
            statement.execute(Files.readString(FIXTURE));
        }
    }

    @Test
    void givenTheFixtureOnTheLatestSchema_whenVerificationReadsIt_thenEveryFixtureRowIsSeen() throws Exception {
        // given
        try (Connection connection = connect(); var statement = connection.createStatement()) {

            // when
            var result = statement.executeQuery(Files.readString(VERIFICATION));

            // then
            assertThat(result.next()).isTrue();
            JsonNode evidence = new ObjectMapper().readTree(result.getString(1));
            assertThat(evidence.path("courtRows").size()).as("fixture courts").isEqualTo(1);
            assertThat(evidence.path("memberRows").size()).as("fixture members").isEqualTo(2);
            assertThat(evidence.path("accountRows").size()).as("fixture accounts").isEqualTo(1);
            assertThat(evidence.path("bookingRows").size()).as("fixture bookings").isEqualTo(2);
            assertThat(evidence.path("allocationRows").size()).as("fixture allocations").isEqualTo(2);
            assertThat(evidence.path("participantRows").size()).as("fixture participants").isEqualTo(2);
            assertThat(evidence.path("seriesRows").size()).as("fixture series").isEqualTo(1);
            assertThat(evidence.path("seriesCourtRows").size()).as("fixture series courts").isEqualTo(1);
            assertThat(evidence.path("sessionRows").size()).as("fixture sessions").isEqualTo(1);
            assertThat(evidence.path("loginLimitRows").size()).as("fixture login limits").isEqualTo(1);
            assertThat(evidence.path("ruleRows").size()).as("fixture rules").isEqualTo(1);
            assertThat(evidence.path("personRows").size()).as("fixture people").isEqualTo(2);
            assertThat(evidence.path("roleRows").size()).as("fixture roles").isEqualTo(2);
            assertThat(evidence.path("ruleSetRows").size()).as("fixture rule sets").isEqualTo(1);
            for (String key : List.of("fixtureAuditEvents", "fixtureMessageRecords", "fixtureMessageOptouts",
                    "fixtureEventPublications", "fixtureImportSources", "fixtureImportTypeMappings",
                    "fixtureImportOwnedFields", "fixtureImportReferences", "fixtureImportPreviews",
                    "fixtureImportRuns")) {
                assertThat(evidence.path(key).asInt()).as(key).isEqualTo(1);
            }
            assertThat(evidence.path("fixtureImportMappings").asInt()).as("fixture import mappings").isEqualTo(2);
            assertThat(evidence.path("configuration").path("club_name").asText())
                    .isEqualTo("Example Tennis Club");
        }
    }

    @Test
    void givenTheFixtureOnTheLatestSchema_whenEveryTableIsRead_thenEachHoldsARow() throws Exception {
        // given
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            List<String> tables = new ArrayList<>();
            var metadata = connection.getMetaData().getTables(null, "public", "%", new String[] {"TABLE"});
            while (metadata.next()) {
                tables.add(metadata.getString("TABLE_NAME"));
            }
            assertThat(tables).as("the migrated tables are read from the public schema").contains("booking", "member");

            // when
            List<String> empty = new ArrayList<>();
            for (String table : tables) {
                var rows = statement.executeQuery("SELECT EXISTS (SELECT 1 FROM \"" + table + "\")");
                rows.next();
                if (!rows.getBoolean(1)) {
                    empty.add(table);
                }
            }

            // then
            assertThat(empty)
                    .as("a migration on these tables never meets data in the upgrade proof; seed them in %s",
                            FIXTURE)
                    .isEmpty();
        }
    }

    @Test
    void givenTheMfaFixture_whenVerificationReadsIt_thenEverySecurityRowIsBoundToItsDisabledAccount() throws Exception {
        // given
        try (Connection connection = connect()) {
            // when
            JsonNode proof = proof(connection);
            // then
            for (String key : List.of("mfaAccountRows", "mfaRecoveryCodeRows", "mfaInstanceKeyRows", "mfaChallengeRows",
                    "webAuthnUserRows", "webAuthnCredentialRows", "mfaAccountRecoveryRows")) {
                assertThat(proof.path(key).size()).as(key).isEqualTo(1);
            }
            JsonNode state = proof.path("mfaAccountRows").get(0);
            assertThat(state.path("account_id").asText()).isEqualTo("72000000-0000-0000-0000-000000000003");
            assertThat(state.path("totp_secret").isNull()).isTrue();
            assertThat(state.path("pending_totp_secret").isNull()).isTrue();
            assertThat(state.path("recovery_pending").asBoolean()).isTrue();
            assertThat(proof.path("mfaInstanceKeyRows").get(0).path("key_check").isNull()).isTrue();
            assertThat(proof.path("mfaRecoveryCodeRows").get(0).path("code_hash").asText())
                    .matches("[0-9a-f]{32}").isNotEqualTo("f".repeat(64));
            assertThat(proof.path("webAuthnCredentialRows").get(0).path("public_key").asText())
                    .matches("[0-9a-f]{32}");
            try (var statement = connection.createStatement()) {
                var account = statement.executeQuery("""
                        SELECT a.enabled, p.email FROM user_account a JOIN person p ON p.id = a.person_id
                        WHERE a.id = '72000000-0000-0000-0000-000000000003'
                        """);
                assertThat(account.next()).isTrue();
                assertThat(account.getBoolean(1)).isFalse();
                assertThat(account.getString(2)).isEqualTo("mfa-upgrade@example.org");
            }
        }
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "mfaAccountRows | account_mfa | recovery_pending = false",
            "mfaRecoveryCodeRows | mfa_recovery_code | code_hash = repeat('1', 64)",
            "mfaInstanceKeyRows | mfa_instance_key | installation_id = '7f200000-0000-0000-0000-000000000099'",
            "mfaChallengeRows | mfa_challenge | attempt_count = 2",
            "webAuthnUserRows | user_entities | display_name = 'Richard Miles updated'",
            "webAuthnCredentialRows | user_credentials | signature_count = 8",
            "mfaAccountRecoveryRows | account_mfa_recovery | address_hash = repeat('2', 64)"
    })
    void givenMfaFixtureRows_whenAStoredValueChanges_thenTheProofDetectsIt(String key, String table, String change) throws Exception {
        // given
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            connection.setAutoCommit(false);
            JsonNode before = proof(connection).path(key);
            assertThat(before.size()).as(key).isEqualTo(1);
            try {
                // when
                assertThat(statement.executeUpdate("UPDATE " + table + " SET " + change)).isEqualTo(1);
                JsonNode after = proof(connection).path(key);
                // then
                assertThat(after).as(key).isNotEqualTo(before);
            } finally {
                connection.rollback();
            }
        }
    }

    @Test
    void givenAnExistingInstanceKey_whenTheFixtureCanaryStatementRuns_thenItsInstallationAndCheckAreRetained() throws Exception {
        // given
        String fixture = Files.readString(FIXTURE);
        int start = fixture.indexOf("INSERT INTO mfa_instance_key");
        assertThat(start).as("fixture includes the legacy keyless installation row").isNotNegative();
        String canary = fixture.substring(start, fixture.indexOf(';', start) + 1);
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            connection.setAutoCommit(false);
            try {
                statement.executeUpdate("""
                        UPDATE mfa_instance_key SET installation_id = '7f200000-0000-0000-0000-000000000099',
                            key_check = 'existing-installation-check'
                        """);
                JsonNode before = proof(connection).path("mfaInstanceKeyRows");
                // when
                statement.execute(canary);
                // then
                assertThat(proof(connection).path("mfaInstanceKeyRows")).isEqualTo(before);
            } finally {
                connection.rollback();
            }
        }
    }

    private static JsonNode proof(Connection connection) throws Exception {
        try (var statement = connection.createStatement(); var result = statement.executeQuery(Files.readString(VERIFICATION))) {
            assertThat(result.next()).isTrue();
            return new ObjectMapper().readTree(result.getString(1));
        }
    }

    private static Connection connect() throws Exception {
        return DriverManager.getConnection(DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
    }
}
