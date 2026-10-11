package org.courtside.notification;

import org.courtside.TestPostgres;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers(disabledWithoutDocker = true)
class NotificationCentreMigrationTest {

    private static final String ACCOUNT = "7f000000-0000-0000-0000-000000000002";

    @Container
    private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>(TestPostgres.deployedImage());

    @Test
    void givenKindsDeclinedBeforeTheCentre_whenTheSchemaMigrates_thenEveryOneStaysDeclinedAndNoChannelIsChosen()
            throws Exception {
        // given
        migrateTo("51");
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            statement.execute("""
                    INSERT INTO person (id, first_name, last_name, email)
                    VALUES ('7f000000-0000-0000-0000-000000000001', 'Jane', 'Doe', 'jane.doe@example.org');
                    INSERT INTO user_account (id, person_id, username, password_hash, locale, enabled)
                    VALUES ('%s', '7f000000-0000-0000-0000-000000000001', 'doe.jane', '{noop}unused', 'en', true);
                    INSERT INTO message_optout (user_account_id, kind)
                    VALUES ('%1$s', 'BOOKING_CONFIRMED'), ('%1$s', 'BOOKING_REMINDER');
                    """.formatted(ACCOUNT));
        }

        // when
        migrateTo("latest");

        // then
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            assertThat(strings(statement.executeQuery(
                    "SELECT kind FROM message_optout WHERE user_account_id = '" + ACCOUNT + "' ORDER BY kind")))
                    .as("a kind declined before the centre existed is still declined after it")
                    .containsExactly("BOOKING_CONFIRMED", "BOOKING_REMINDER");
            assertThat(strings(statement.executeQuery("SELECT channel FROM message_channel_optout")))
                    .as("the migration chooses no channel for anybody, so email stays as it was")
                    .isEmpty();
            assertThat(strings(statement.executeQuery("SELECT id::text FROM notification")))
                    .as("the migration invents no notification")
                    .isEmpty();
        }
    }

    private static void migrateTo(String target) {
        Flyway.configure()
                .dataSource(DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private static List<String> strings(ResultSet rows) throws Exception {
        List<String> values = new ArrayList<>();
        while (rows.next()) {
            values.add(rows.getString(1));
        }
        return values;
    }

    private static Connection connect() throws Exception {
        return DriverManager.getConnection(DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
    }
}
