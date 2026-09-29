package org.courtside;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.courtside.shared.DatabaseMigration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers(disabledWithoutDocker = true)
class UpgradeFixtureTest {

    private static final Path FIXTURE = Path.of("upgrade", "fixtures", "origin.sql");
    private static final Path VERIFICATION = Path.of("upgrade", "verify.sql");

    @Container
    private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>(TestPostgres.deployedImage());

    @TempDir
    private Path temporaryDirectory;

    @Test
    void givenTheSchemaThisCommitShips_whenTheUpgradeFixtureLoads_thenVerificationSeesEveryFixtureRow()
            throws Exception {
        // given
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

            // when
            statement.execute(Files.readString(FIXTURE));
            var result = statement.executeQuery(Files.readString(VERIFICATION));

            // then
            assertThat(result.next()).isTrue();
            JsonNode evidence = new ObjectMapper().readTree(result.getString(1));
            assertThat(evidence.path("courtRows").size()).as("fixture courts").isEqualTo(1);
            assertThat(evidence.path("memberRows").size()).as("fixture members").isEqualTo(2);
            assertThat(evidence.path("accountRows").size()).as("fixture accounts").isEqualTo(1);
            assertThat(evidence.path("bookingRows").size()).as("fixture bookings").isEqualTo(2);
            assertThat(evidence.path("allocationRows").size()).as("fixture allocations").isEqualTo(2);
            assertThat(evidence.path("participantRows").size()).as("fixture participants").isEqualTo(1);
            assertThat(evidence.path("seriesRows").size()).as("fixture series").isEqualTo(1);
            assertThat(evidence.path("seriesCourtRows").size()).as("fixture series courts").isEqualTo(1);
            assertThat(evidence.path("sessionRows").size()).as("fixture sessions").isEqualTo(1);
            assertThat(evidence.path("loginLimitRows").size()).as("fixture login limits").isEqualTo(1);
            assertThat(evidence.path("ruleRows").size()).as("fixture rules").isEqualTo(1);
            assertThat(evidence.path("configuration").path("club_name").asText())
                    .isEqualTo("Example Tennis Club");
        }
    }

    private static Connection connect() throws Exception {
        return DriverManager.getConnection(DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
    }
}
