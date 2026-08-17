package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = "courtside.test.clock=2026-03-01T10:00:00Z")
class SeriesDaylightSavingTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final ZoneId ZONE = ZoneId.of("Europe/Berlin");
    private static final LocalDate BEFORE_THE_AUTUMN_CHANGE = LocalDate.of(2026, 10, 20);
    private static final LocalDate BEFORE_THE_SPRING_CHANGE = LocalDate.of(2027, 3, 23);

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private JdbcClient jdbc;

    private UUID court;
    private final UUID trainer = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        court = courts.save(new Court(1, "Court 1")).getId();

        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
    }

    @Test
    void givenASeriesCrossingTheAutumnChange_whenCreating_thenEveryAllocationRowKeepsItsLocalTime() {
        // given
        SeriesRule rule = tuesdaysAt(BEFORE_THE_AUTUMN_CHANGE, LocalTime.of(18, 0), 2);

        // when
        SeriesCreationResult result = create(rule);

        // then
        assertThat(result.bookingIds()).hasSize(2);
        List<TimeSlot> rows = allocationRows();
        assertThat(localTimesOf(rows, TimeSlot::start)).containsExactly(
                LocalDateTime.of(2026, 10, 20, 18, 0), LocalDateTime.of(2026, 10, 27, 18, 0));
        assertThat(localTimesOf(rows, TimeSlot::end)).containsExactly(
                LocalDateTime.of(2026, 10, 20, 20, 0), LocalDateTime.of(2026, 10, 27, 20, 0));
        assertThat(rows.getLast().start())
                .isNotEqualTo(rows.getFirst().start().plus(7, ChronoUnit.DAYS));
    }

    @Test
    void givenASeriesCrossingTheSpringChange_whenCreating_thenEveryAllocationRowKeepsItsLocalTime() {
        // given
        SeriesRule rule = tuesdaysAt(BEFORE_THE_SPRING_CHANGE, LocalTime.of(18, 0), 2);

        // when
        SeriesCreationResult result = create(rule);

        // then
        assertThat(result.bookingIds()).hasSize(2);
        List<TimeSlot> rows = allocationRows();
        assertThat(localTimesOf(rows, TimeSlot::start)).containsExactly(
                LocalDateTime.of(2027, 3, 23, 18, 0), LocalDateTime.of(2027, 3, 30, 18, 0));
        assertThat(localTimesOf(rows, TimeSlot::end)).containsExactly(
                LocalDateTime.of(2027, 3, 23, 20, 0), LocalDateTime.of(2027, 3, 30, 20, 0));
        assertThat(rows.getLast().start())
                .isNotEqualTo(rows.getFirst().start().plus(7, ChronoUnit.DAYS));
    }

    @Test
    void givenASeriesCrossingTheAutumnChange_whenMovingTheWholeSeries_thenEveryOccurrenceHoldsTheRequestedLocalTime() {
        // given
        SeriesCreationResult series = create(tuesdaysAt(BEFORE_THE_AUTUMN_CHANGE, LocalTime.of(18, 0), 2));

        // when
        int moved = seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isEqualTo(2);
        List<TimeSlot> rows = allocationRows();
        assertThat(localTimesOf(rows, TimeSlot::start)).containsExactly(
                LocalDateTime.of(2026, 10, 20, 20, 0), LocalDateTime.of(2026, 10, 27, 20, 0));
        assertThat(localTimesOf(rows, TimeSlot::end)).containsExactly(
                LocalDateTime.of(2026, 10, 20, 22, 0), LocalDateTime.of(2026, 10, 27, 22, 0));
        assertThat(rows.getLast().start())
                .isNotEqualTo(rows.getFirst().start().plus(7, ChronoUnit.DAYS));
    }

    @Test
    void givenASeriesCrossingTheSpringChange_whenMovingTheWholeSeries_thenEveryOccurrenceHoldsTheRequestedLocalTime() {
        // given
        SeriesCreationResult series = create(tuesdaysAt(BEFORE_THE_SPRING_CHANGE, LocalTime.of(18, 0), 2));

        // when
        int moved = seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isEqualTo(2);
        List<TimeSlot> rows = allocationRows();
        assertThat(localTimesOf(rows, TimeSlot::start)).containsExactly(
                LocalDateTime.of(2027, 3, 23, 20, 0), LocalDateTime.of(2027, 3, 30, 20, 0));
        assertThat(localTimesOf(rows, TimeSlot::end)).containsExactly(
                LocalDateTime.of(2027, 3, 23, 22, 0), LocalDateTime.of(2027, 3, 30, 22, 0));
        assertThat(rows.getLast().start())
                .isNotEqualTo(rows.getFirst().start().plus(7, ChronoUnit.DAYS));
    }

    private SeriesRule tuesdaysAt(LocalDate startsOn, LocalTime startTime, int count) {
        return new SeriesRule(List.of(court), TRAINING_CARD, startsOn, startTime, 120,
                1, Set.of(DayOfWeek.TUESDAY), null, count);
    }

    private SeriesCreationResult create(SeriesRule rule) {
        List<Instant> starts = seriesService.preview(rule, trainer, null, Set.of(Role.TRAINER))
                .occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, trainer, null, Set.of(Role.TRAINER), "Team training");
    }

    private List<TimeSlot> allocationRows() {
        return jdbc.sql("SELECT starts_at, ends_at FROM court_allocation ORDER BY starts_at")
                .query((rs, rowNum) -> new TimeSlot(
                        rs.getObject("starts_at", OffsetDateTime.class).toInstant(),
                        rs.getObject("ends_at", OffsetDateTime.class).toInstant()))
                .list();
    }

    private static List<LocalDateTime> localTimesOf(List<TimeSlot> rows,
                                                    Function<TimeSlot, Instant> field) {
        return rows.stream()
                .map(row -> LocalDateTime.ofInstant(field.apply(row), ZONE))
                .toList();
    }
}
