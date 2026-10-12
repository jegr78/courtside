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
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers(disabledWithoutDocker = true)
class CancellationMessageMigrationTest {

    private static final String ACCOUNT = "7f000000-0000-0000-0000-000000000012";

    @Container
    private final PostgreSQLContainer<?> database = new PostgreSQLContainer<>(TestPostgres.deployedImage());

    @Test
    void givenAnEarlierOptOut_whenTheCancellationKindsArrive_thenItSurvivesAndOnlyTheMemberCancellationMayBeDeclined()
            throws Exception {
        // given
        migrateTo("53");
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            statement.execute("""
                    INSERT INTO person (id, first_name, last_name, email)
                    VALUES ('7f000000-0000-0000-0000-000000000011', 'Jane', 'Doe', 'jane.doe@example.org');
                    INSERT INTO user_account (id, person_id, username, password_hash, locale, enabled)
                    VALUES ('%s', '7f000000-0000-0000-0000-000000000011', 'doe.jane', '{noop}unused', 'en', true);
                    INSERT INTO message_optout (user_account_id, kind) VALUES ('%1$s', 'BOOKING_PLAYER_WITHDREW');
                    """.formatted(ACCOUNT));
        }

        // when
        migrateTo("latest");

        // then
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            statement.execute("""
                    INSERT INTO message_optout (user_account_id, kind)
                    VALUES ('%1$s', 'BOOKING_CANCELLED'), ('%1$s', 'BOOKING_SERIES_CREATED');
                    """.formatted(ACCOUNT));
            assertThat(strings(statement.executeQuery(
                    "SELECT kind FROM message_optout WHERE user_account_id = '" + ACCOUNT + "' ORDER BY kind")))
                    .containsExactly("BOOKING_CANCELLED", "BOOKING_PLAYER_WITHDREW", "BOOKING_SERIES_CREATED");
            assertThatThrownBy(() -> statement.execute(
                    "INSERT INTO message_optout (user_account_id, kind) VALUES ('" + ACCOUNT
                            + "', 'BOOKING_CANCELLED_BY_CLUB')"))
                    .as("the club's cancellation cannot be stored as declined")
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("message_optout_kind_declinable");
        }
    }

    @Test
    void givenACancelledBookingFromBefore_whenTheReasonColumnArrives_thenItNamesNoneAndOnlyAKnownCodeOnACancellationFits()
            throws Exception {
        // given
        migrateTo("53");
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            statement.execute("""
                    INSERT INTO person (id, first_name, last_name, email)
                    VALUES ('7f000000-0000-0000-0000-000000000011', 'Jane', 'Doe', 'jane.doe@example.org');
                    INSERT INTO user_account (id, person_id, username, password_hash, locale, enabled)
                    VALUES ('%1$s', '7f000000-0000-0000-0000-000000000011', 'doe.jane', '{noop}unused', 'en', true);
                    INSERT INTO booking (id, card_id, status, booked_by, created_at, cancelled_at, cancelled_by)
                    VALUES ('7f000000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111',
                            'CANCELLED', '%1$s', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '%1$s'),
                           ('7f000000-0000-0000-0000-000000000022', '11111111-1111-1111-1111-111111111111',
                            'CONFIRMED', '%1$s', '2026-01-01T00:00:00Z', NULL, NULL);
                    """.formatted(ACCOUNT));
        }

        // when
        migrateTo("latest");

        // then
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            assertThat(strings(statement.executeQuery(
                    "SELECT coalesce(cancellation_reason, 'none') FROM booking ORDER BY id")))
                    .as("a cancellation recorded before reasons existed names none")
                    .containsExactly("none", "none");
            statement.execute("UPDATE booking SET cancellation_reason = 'WEATHER' "
                    + "WHERE id = '7f000000-0000-0000-0000-000000000021'");
            assertThatThrownBy(() -> statement.execute("UPDATE booking SET cancellation_reason = 'RAIN' "
                    + "WHERE id = '7f000000-0000-0000-0000-000000000021'"))
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("booking_cancellation_reason_known");
            assertThatThrownBy(() -> statement.execute("UPDATE booking SET cancellation_reason = 'WEATHER' "
                    + "WHERE id = '7f000000-0000-0000-0000-000000000022'"))
                    .as("a booking that stands has no cancellation reason")
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("booking_cancellation_reason_only_when_cancelled");
        }
    }

    private void migrateTo(String target) {
        Flyway.configure()
                .dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword())
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

    private Connection connect() throws Exception {
        return DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
    }
}
