package org.courtside.shared;

import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesSchedule;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.quicktheories.QuickTheory.qt;
import static org.quicktheories.generators.SourceDSL.integers;

class CriticalTimePropertiesTest {

    private static final long SEED = 2_026_08_16L;
    private static final UUID COURT_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID CARD_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");

    @Test
    void givenGeneratedRanges_whenComparingOverlap_thenTheRelationIsSymmetricAndAdjacencyIsFree() {
        // given / when / then
        qt().withFixedSeed(SEED).withExamples(1_000)
                .forAll(integers().between(-1_000_000, 1_000_000),
                        integers().between(1, 86_400), integers().between(1, 86_400))
                .check((startSecond, firstLength, secondLength) -> {
                    Instant start = Instant.EPOCH.plusSeconds(startSecond);
                    TimeSlot first = new TimeSlot(start, start.plusSeconds(firstLength));
                    TimeSlot adjacent = new TimeSlot(first.end(), first.end().plusSeconds(secondLength));
                    TimeSlot overlapping = new TimeSlot(first.end().minusSeconds(1),
                            first.end().plusSeconds(secondLength));
                    return first.overlaps(overlapping) == overlapping.overlaps(first)
                            && !first.overlaps(adjacent)
                            && first.duration().equals(Duration.ofSeconds(firstLength));
                });
    }

    @Test
    void givenGeneratedOpeningWindows_whenCheckingContainedRanges_thenBothBoundariesAreInclusive() {
        // given / when / then
        qt().withFixedSeed(SEED).withExamples(1_000)
                .forAll(integers().between(0, 1_438), integers().between(0, 1_438))
                .check((opensAt, rawDuration) -> {
                    int closesAt = opensAt + 1 + rawDuration % (1_439 - opensAt);
                    OpeningWindow window = new OpeningWindow(time(opensAt), time(closesAt));
                    boolean rejectsEarlierStart = opensAt == 0
                            || !window.covers(time(opensAt - 1), time(closesAt));
                    boolean rejectsLaterEnd = closesAt == 1_439
                            || !window.covers(time(opensAt), time(closesAt + 1));
                    return window.covers(time(opensAt), time(closesAt))
                            && rejectsEarlierStart && rejectsLaterEnd;
                });
    }

    @Test
    void givenGeneratedCalendarSeries_whenExpanding_thenCountOrderAndClubWallTimeRemainStable() {
        // given / when / then
        int firstDay = Math.toIntExact(LocalDate.of(2024, 1, 1).toEpochDay());
        int lastDay = Math.toIntExact(LocalDate.of(2032, 12, 31).toEpochDay());
        qt().withFixedSeed(SEED).withExamples(600)
                .forAll(integers().between(firstDay, lastDay), integers().between(1, 4),
                        integers().between(1, 20), integers().between(0, 3))
                .check((epochDay, intervalWeeks, count, zoneIndex) -> {
                    LocalDate start = LocalDate.ofEpochDay(epochDay);
                    ZoneId zone = zone(zoneIndex);
                    LocalTime wallTime = LocalTime.of(18, 0);
                    SeriesRule rule = new SeriesRule(List.of(COURT_ID), CARD_ID, start, wallTime, 90,
                            intervalWeeks, Set.of(start.getDayOfWeek()), null, count);
                    List<TimeSlot> slots = new SeriesSchedule(() -> zone, 24).expand(rule).slots();
                    for (int index = 0; index < slots.size(); index++) {
                        LocalDateTime actual = LocalDateTime.ofInstant(slots.get(index).start(), zone);
                        LocalDate expectedDate = start.plusWeeks((long) index * intervalWeeks);
                        if (!actual.equals(expectedDate.atTime(wallTime))) {
                            return false;
                        }
                    }
                    return slots.size() == count && isStrictlyOrdered(slots);
                });
    }

    private static LocalTime time(int minuteOfDay) {
        return LocalTime.of(minuteOfDay / 60, minuteOfDay % 60);
    }

    private static ZoneId zone(int index) {
        return switch (index) {
            case 0 -> ZoneId.of("Europe/Berlin");
            case 1 -> ZoneId.of("Australia/Lord_Howe");
            case 2 -> ZoneId.of("Pacific/Auckland");
            default -> ZoneId.of("Asia/Kathmandu");
        };
    }

    private static boolean isStrictlyOrdered(List<TimeSlot> slots) {
        for (int index = 1; index < slots.size(); index++) {
            if (!slots.get(index).start().isAfter(slots.get(index - 1).start())) {
                return false;
            }
        }
        return true;
    }
}
