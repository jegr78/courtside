package org.courtside.shared;

import org.courtside.TestPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.containers.PostgreSQLContainer;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class MessageOutboxMigrationTest {

    private static PostgreSQLContainer<?> database;

    @TempDir
    private Path directory;

    @BeforeAll
    static void startTheDatabase() {
        database = new PostgreSQLContainer<>(TestPostgres.deployedImage());
        database.start();
    }

    @AfterAll
    static void stopTheDatabase() {
        database.stop();
    }

    @Test
    void givenAMessageLeftQueuedByTheHandoverBeforeTheOutbox_whenTheOutboxArrives_thenItIsSettledAndNeverSent()
            throws Exception {
        // given — the old handover queued its row before it tried the relay, and a killed process left it there
        Map<String, String> environment = environment();
        DatabaseMigration.migrate(environment, "50");
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            statement.execute("""
                    INSERT INTO person (id, first_name, last_name, email)
                    VALUES ('7a000000-0000-0000-0000-000000000001', 'Jane', 'Doe', 'jane.doe@example.org');
                    INSERT INTO user_account (id, person_id, username, password_hash, locale, enabled)
                    VALUES ('7a000000-0000-0000-0000-000000000002', '7a000000-0000-0000-0000-000000000001',
                            'doe.jane', '{noop}unused', 'en', true);
                    INSERT INTO message_record (id, account_id, kind, state, message_id, queued_at)
                    VALUES ('7a000000-0000-0000-0000-000000000003', '7a000000-0000-0000-0000-000000000002',
                            'CREDENTIALS_PASSWORD_RESET', 'QUEUED', '<orphan@example.org>',
                            '2026-01-01T00:00:00Z');
                    """);
        }

        // when
        DatabaseMigration.migrate(environment);

        // then
        try (Connection connection = connect(); var statement = connection.createStatement();
             ResultSet row = statement.executeQuery("""
                     SELECT state, reason, settled_at, next_attempt_at FROM message_record
                     WHERE id = '7a000000-0000-0000-0000-000000000003'
                     """)) {
            assertThat(row.next()).isTrue();
            assertThat(row.getString("state"))
                    .as("an old request is not turned into a fresh credential by the outbox")
                    .isEqualTo("FAILED");
            assertThat(row.getString("reason")).isEqualTo("InterruptedBeforeOutbox");
            assertThat(row.getTimestamp("settled_at")).isNotNull();
            assertThat(row.getTimestamp("next_attempt_at")).as("no pass will ever claim it").isNull();
        }
    }

    private Map<String, String> environment() throws Exception {
        Path password = Files.writeString(directory.resolve("migration-password"), database.getPassword() + "\n");
        return Map.of(
                "SPRING_DATASOURCE_URL", database.getJdbcUrl(),
                "COURTSIDE_DB_MIGRATION_USERNAME", database.getUsername(),
                "COURTSIDE_DB_MIGRATION_PASSWORD_FILE", password.toString(),
                "COURTSIDE_DB_TLS_MODE", "prefer");
    }

    private static Connection connect() throws Exception {
        return DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
    }
}
