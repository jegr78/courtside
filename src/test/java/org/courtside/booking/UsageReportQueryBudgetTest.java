package org.courtside.booking;

import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.courtside.booking.internal.UsageReportService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(FacilityTestFixture.class)
class UsageReportQueryBudgetTest extends AbstractIntegrationTest {

    private static final LocalDate FROM = LocalDate.of(2026, 2, 1);
    private static final LocalDate TO = LocalDate.of(2026, 2, 28);

    @Autowired
    private UsageReportService usage;

    @Autowired
    private SqlStatementCounter queries;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private JdbcClient jdbc;

    @AfterEach
    void stopCountingQueries() {
        queries.pause();
    }

    @Test
    void givenMoreBookingsCancellationsAndRefusals_whenReportingUsage_thenTheStatementCountStaysTheSame() {
        // given
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        UUID court = facility.createCourt(1, "Centre");
        book(List.of(court), 2, 9);
        long few = statements();
        for (int number = 2; number <= 4; number++) {
            facility.createCourt(number, "Court " + number);
        }
        book(jdbc.sql("SELECT id FROM court").query(UUID.class).list(), 20, 11);
        jdbc.sql("UPDATE booking SET status = 'CANCELLED', cancellation_reason = 'WEATHER' WHERE id IN "
                + "(SELECT id FROM booking ORDER BY id LIMIT 10)").update();
        jdbc.sql("""
                        INSERT INTO booking_rule_rejection (id, attempt_id, rule_code, rejected_at, card_id)
                        SELECT gen_random_uuid(), gen_random_uuid(), 'booking.rule.startsInPast',
                               TIMESTAMPTZ '2026-02-10 10:00+00', '11111111-1111-1111-1111-111111111111'
                        FROM generate_series(1, 25)
                        """).update();

        // when
        long many = statements();

        // then
        assertThat(many).as("the usage report reads with a fixed number of statements, however much it covers")
                .isEqualTo(few);
    }

    private long statements() {
        queries.reset();
        usage.report(FROM, TO);
        long total = queries.snapshot().total();
        queries.pause();
        return total;
    }

    private void book(List<UUID> courts, int days, int hour) {
        jdbc.sql("""
                        WITH slots AS (
                            SELECT gen_random_uuid() AS booking_id, court_id, day
                            FROM unnest(CAST(:courts AS uuid[])) AS court_id,
                                 generate_series(TIMESTAMP '2026-02-01 00:00',
                                                 TIMESTAMP '2026-02-01 00:00' + make_interval(days => :days - 1),
                                                 interval '1 day') AS day
                        ),
                        bookings AS (
                            INSERT INTO booking (id, card_id, status)
                            SELECT booking_id, '11111111-1111-1111-1111-111111111111', 'CONFIRMED' FROM slots
                            RETURNING id
                        )
                        INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                        SELECT gen_random_uuid(), booking_id, court_id,
                               timezone('Europe/Berlin', day + make_interval(hours => :hour)),
                               timezone('Europe/Berlin', day + make_interval(hours => :hour + 1)), 'CONFIRMED'
                        FROM slots
                        """)
                .param("courts", courts.toArray(UUID[]::new))
                .param("days", days)
                .param("hour", hour)
                .update();
    }
}
