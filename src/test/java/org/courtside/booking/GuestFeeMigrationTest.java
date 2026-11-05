package org.courtside.booking;

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
class GuestFeeMigrationTest {

    private static final String ACCOUNT = "7f000000-0000-0000-0000-000000000012";
    private static final String BOOKING = "7f000000-0000-0000-0000-000000000021";

    @Container
    private final PostgreSQLContainer<?> database = new PostgreSQLContainer<>(TestPostgres.deployedImage());

    @Test
    void givenAGuestBookedBeforeTheFeeExisted_whenTheFeeArrives_thenTheGuestOwesNothingInTheClubCurrency()
            throws Exception {
        // given
        migrateTo("81");
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            statement.execute("""
                    INSERT INTO person (id, first_name, last_name, email)
                    VALUES ('7f000000-0000-0000-0000-000000000011', 'Jane', 'Doe', 'jane.doe@example.org');
                    INSERT INTO user_account (id, person_id, username, password_hash, locale, enabled)
                    VALUES ('%1$s', '7f000000-0000-0000-0000-000000000011', 'doe.jane', '{noop}unused', 'en', true);
                    INSERT INTO booking (id, card_id, status, booked_by, created_at)
                    VALUES ('%2$s', '11111111-1111-1111-1111-111111111111', 'CONFIRMED', '%1$s',
                            '2026-01-01T00:00:00Z');
                    INSERT INTO booking_participant (id, booking_id, kind, person_id, position)
                    VALUES ('7f000000-0000-0000-0000-000000000031', '%2$s', 'MEMBER',
                            '7f000000-0000-0000-0000-000000000011', 1);
                    INSERT INTO booking_participant (id, booking_id, kind, guest_name, position)
                    VALUES ('7f000000-0000-0000-0000-000000000032', '%2$s', 'GUEST', 'John Roe', 2);
                    """.formatted(ACCOUNT, BOOKING));
        }

        // when
        migrateTo("latest");

        // then
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            assertThat(strings(statement.executeQuery("""
                    SELECT kind || ':' || coalesce(guest_fee_minor::text, '-') || ':' || coalesce(guest_fee_currency, '-')
                    FROM booking_participant ORDER BY position
                    """)))
                    .as("the earlier guest is charged nothing and the member carries no fee")
                    .containsExactly("MEMBER:-:-", "GUEST:0:EUR");
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
