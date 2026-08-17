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
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.zone.ZoneOffsetTransition;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;

// Lord_Howe shifts half an hour, on other dates, in the opposite direction to Berlin: code that
// assumed "one hour" passes every Berlin-only test and drifts here.
class SeriesDaylightSavingLordHoweTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final ZoneId ZONE = ZoneId.of("Australia/Lord_Howe");

    // From ZoneId.of("Australia/Lord_Howe").getRules(), tzdb 2025b: 2026-10-04 is the gap
    // (+10:30 to +11:00) and 2027-04-04 the overlap (+11:00 to +10:30).
    private static final LocalDate BEFORE_THE_GAP = LocalDate.of(2026, 9, 27);
    private static final LocalDate THE_GAP = LocalDate.of(2026, 10, 4);
    private static final LocalDate BEFORE_THE_OVERLAP = LocalDate.of(2027, 3, 28);
    private static final LocalDate THE_OVERLAP = LocalDate.of(2027, 4, 4);

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
        jdbc.sql("UPDATE club_config SET time_zone = ?").param(ZONE.getId()).update();
        court = courts.save(new Court(1, "Court 1")).getId();

        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
    }

    @Test
    void givenASeriesCrossingTheLordHoweGap_whenCreating_thenEveryAllocationRowKeepsItsLocalTime() {
        // given
        SeriesRule rule = sundaysAt(BEFORE_THE_GAP, LocalTime.of(18, 0), 2);

        // when
        SeriesCreationResult result = create(rule);

        // then
        assertThat(result.bookingIds()).hasSize(2);
        List<TimeSlot> rows = allocationRows();
        assertThat(localTimesOf(rows, TimeSlot::start)).containsExactly(
                LocalDateTime.of(2026, 9, 27, 18, 0), LocalDateTime.of(2026, 10, 4, 18, 0));
        assertThat(localTimesOf(rows, TimeSlot::end)).containsExactly(
                LocalDateTime.of(2026, 9, 27, 20, 0), LocalDateTime.of(2026, 10, 4, 20, 0));
        assertThat(rows.getLast().start())
                .isNotEqualTo(rows.getFirst().start().plus(7, ChronoUnit.DAYS));
        assertThat(Duration.between(rows.getFirst().start(), rows.getLast().start()))
                .isEqualTo(Duration.ofDays(7).minus(offsetShiftAfter(rows.getFirst().start())));
    }

    @Test
    void givenASeriesCrossingTheLordHoweOverlap_whenCreating_thenEveryAllocationRowKeepsItsLocalTime() {
        // given
        SeriesRule rule = sundaysAt(BEFORE_THE_OVERLAP, LocalTime.of(18, 0), 2);

        // when
        SeriesCreationResult result = create(rule);

        // then
        assertThat(result.bookingIds()).hasSize(2);
        List<TimeSlot> rows = allocationRows();
        assertThat(localTimesOf(rows, TimeSlot::start)).containsExactly(
                LocalDateTime.of(2027, 3, 28, 18, 0), LocalDateTime.of(2027, 4, 4, 18, 0));
        assertThat(localTimesOf(rows, TimeSlot::end)).containsExactly(
                LocalDateTime.of(2027, 3, 28, 20, 0), LocalDateTime.of(2027, 4, 4, 20, 0));
        assertThat(rows.getLast().start())
                .isNotEqualTo(rows.getFirst().start().plus(7, ChronoUnit.DAYS));
        assertThat(Duration.between(rows.getFirst().start(), rows.getLast().start()))
                .isEqualTo(Duration.ofDays(7).minus(offsetShiftAfter(rows.getFirst().start())));
    }

    @Test
    void givenASeriesCrossingTheLordHoweGap_whenMovingTheWholeSeries_thenEveryOccurrenceHoldsTheRequestedLocalTime() {
        // given
        SeriesCreationResult series = create(sundaysAt(BEFORE_THE_GAP, LocalTime.of(18, 0), 2));

        // when
        int moved = seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isEqualTo(2);
        List<TimeSlot> rows = allocationRows();
        assertThat(localTimesOf(rows, TimeSlot::start)).containsExactly(
                LocalDateTime.of(2026, 9, 27, 20, 0), LocalDateTime.of(2026, 10, 4, 20, 0));
        assertThat(localTimesOf(rows, TimeSlot::end)).containsExactly(
                LocalDateTime.of(2026, 9, 27, 22, 0), LocalDateTime.of(2026, 10, 4, 22, 0));
        assertThat(rows.getLast().start())
                .isNotEqualTo(rows.getFirst().start().plus(7, ChronoUnit.DAYS));
        assertThat(Duration.between(rows.getFirst().start(), rows.getLast().start()))
                .isEqualTo(Duration.ofDays(7).minus(offsetShiftAfter(rows.getFirst().start())));
    }

    @Test
    void givenASeriesCrossingTheLordHoweOverlap_whenMovingTheWholeSeries_thenEveryOccurrenceHoldsTheRequestedLocalTime() {
        // given
        SeriesCreationResult series = create(sundaysAt(BEFORE_THE_OVERLAP, LocalTime.of(18, 0), 2));

        // when
        int moved = seriesService.move(new MoveRequest(
                series.seriesId(), series.bookingIds().getFirst(), CancelScope.WHOLE_SERIES,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isEqualTo(2);
        List<TimeSlot> rows = allocationRows();
        assertThat(localTimesOf(rows, TimeSlot::start)).containsExactly(
                LocalDateTime.of(2027, 3, 28, 20, 0), LocalDateTime.of(2027, 4, 4, 20, 0));
        assertThat(localTimesOf(rows, TimeSlot::end)).containsExactly(
                LocalDateTime.of(2027, 3, 28, 22, 0), LocalDateTime.of(2027, 4, 4, 22, 0));
        assertThat(rows.getLast().start())
                .isNotEqualTo(rows.getFirst().start().plus(7, ChronoUnit.DAYS));
        assertThat(Duration.between(rows.getFirst().start(), rows.getLast().start()))
                .isEqualTo(Duration.ofDays(7).minus(offsetShiftAfter(rows.getFirst().start())));
    }

    private SeriesRule sundaysAt(LocalDate startsOn, LocalTime startTime, int count) {
        return new SeriesRule(List.of(court), TRAINING_CARD, startsOn, startTime, 120,
                1, Set.of(DayOfWeek.SUNDAY), null, count);
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

    private static Duration offsetShiftAfter(Instant instant) {
        ZoneOffsetTransition transition = ZONE.getRules().nextTransition(instant);
        return Duration.ofSeconds(transition.getOffsetAfter().getTotalSeconds()
                - transition.getOffsetBefore().getTotalSeconds());
    }
}
