package org.courtside.reporting;

import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.reporting.internal.StatisticsService;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

@Import(FacilityTestFixture.class)
class StatisticsQueryBudgetTest extends AbstractIntegrationTest {

    private static final LocalDate FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate TO = LocalDate.of(2026, 4, 30);

    @Autowired
    private StatisticsService statistics;

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
    void givenMoreBookingsCourtsAndARetiredCourt_whenReadingEverySection_thenTheStatementCountStaysTheSame() {
        // given
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        UUID first = facility.createCourt(1, "Centre");
        UUID retired = facility.createCourt(2, "Clay");
        book(List.of(first, retired), 1, 9);
        facility.deactivateCourt(retired);
        Map<String, Long> few = statementsPerSection();
        for (int number = 3; number <= 6; number++) {
            facility.createCourt(number, "Court " + number);
        }
        book(jdbc.sql("SELECT id FROM court").query(UUID.class).list(), 40, 11);

        // when
        Map<String, Long> many = statementsPerSection();

        // then
        assertThat(many).as("a section reads with a fixed number of statements, however much it covers")
                .isEqualTo(few);
    }

    private Map<String, Long> statementsPerSection() {
        Map<String, Consumer<StatisticsService>> sections = new LinkedHashMap<>();
        sections.put("range", StatisticsService::range);
        sections.put("utilisation", service -> service.utilisation(FROM, TO));
        sections.put("bookings", service -> service.bookings(FROM, TO));
        sections.put("members", service -> service.members(FROM, TO));
        sections.put("messages", service -> service.messages(FROM, TO));
        Map<String, Long> counts = new LinkedHashMap<>();
        sections.forEach((name, read) -> {
            queries.reset();
            read.accept(statistics);
            counts.put(name, queries.snapshot().total());
            queries.pause();
        });
        return counts;
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
