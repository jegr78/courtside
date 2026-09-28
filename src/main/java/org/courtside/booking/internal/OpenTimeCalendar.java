package org.courtside.booking.internal;

import org.courtside.facility.OpeningSchedule;
import org.courtside.facility.OpeningWeek;
import org.courtside.shared.OpeningWindow;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.time.zone.ZoneOffsetTransition;
import java.time.zone.ZoneRules;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.NavigableSet;
import java.util.Optional;
import java.util.TreeSet;
import java.util.UUID;

final class OpenTimeCalendar {

    private final OpeningSchedule schedule;
    private final ZoneId zone;
    private final Map<UUID, WeekCalendar> calendars = new HashMap<>();

    OpenTimeCalendar(OpeningSchedule schedule, ZoneId zone) {
        this.schedule = schedule;
        this.zone = zone;
    }

    long openSeconds(LocalDate from, LocalDate to) {
        long total = 0;
        for (Segment segment : segments(from, to)) {
            total += segment.calendar().openSeconds(segment.from(), segment.to());
        }
        return total;
    }

    long[][] hourSeconds(LocalDate from, LocalDate to) {
        long[][] hours = new long[7][24];
        for (Segment segment : segments(from, to)) {
            long[][] part = segment.calendar().hourSeconds(segment.from(), segment.to());
            for (int day = 0; day < 7; day++) {
                for (int hour = 0; hour < 24; hour++) {
                    hours[day][hour] += part[day][hour];
                }
            }
        }
        return hours;
    }

    private List<Segment> segments(LocalDate from, LocalDate to) {
        List<Segment> segments = new ArrayList<>();
        LocalDate start = from;
        while (!start.isAfter(to)) {
            LocalDate end = schedule.nextChangeAfter(start).map(next -> next.minusDays(1))
                    .filter(last -> last.isBefore(to)).orElse(to);
            Optional<OpeningWeek> week = schedule.weekOn(start);
            if (week.isPresent()) {
                segments.add(new Segment(start, end, calendars.computeIfAbsent(week.get().id(),
                        id -> new WeekCalendar(week.get().days(), zone))));
            }
            start = end.plusDays(1);
        }
        return segments;
    }

    private record Segment(LocalDate from, LocalDate to, WeekCalendar calendar) {
    }

    private static final class WeekCalendar {

        private static final LocalDate A_MONDAY = LocalDate.of(2024, 1, 1);

        private final Map<DayOfWeek, OpeningWindow> week = new EnumMap<>(DayOfWeek.class);
        private final ZoneId zone;
        private final long[][] regularDay = new long[7][24];
        private final long[] regularTotal = new long[7];

        WeekCalendar(Map<DayOfWeek, OpeningWindow> week, ZoneId zone) {
            this.week.putAll(week);
            this.zone = zone;
            for (DayOfWeek day : DayOfWeek.values()) {
                long[] cells = day(A_MONDAY.plusDays(day.getValue() - 1L), ZoneOffset.UTC);
                System.arraycopy(cells, 0, regularDay[day.getValue() - 1], 0, 24);
                for (long cell : cells) {
                    regularTotal[day.getValue() - 1] += cell;
                }
            }
        }

        long openSeconds(LocalDate from, LocalDate to) {
            long total = 0;
            for (DayOfWeek day : DayOfWeek.values()) {
                total += occurrences(day, from, to) * regularTotal[day.getValue() - 1];
            }
            for (LocalDate irregular : irregularDays(from, to)) {
                int index = irregular.getDayOfWeek().getValue() - 1;
                for (long cell : day(irregular, zone)) {
                    total += cell;
                }
                total -= regularTotal[index];
            }
            return total;
        }

        long[][] hourSeconds(LocalDate from, LocalDate to) {
            long[][] hours = new long[7][24];
            for (DayOfWeek day : DayOfWeek.values()) {
                long times = occurrences(day, from, to);
                for (int hour = 0; hour < 24; hour++) {
                    hours[day.getValue() - 1][hour] = times * regularDay[day.getValue() - 1][hour];
                }
            }
            for (LocalDate irregular : irregularDays(from, to)) {
                int index = irregular.getDayOfWeek().getValue() - 1;
                long[] actual = day(irregular, zone);
                for (int hour = 0; hour < 24; hour++) {
                    hours[index][hour] += actual[hour] - regularDay[index][hour];
                }
            }
            return hours;
        }

        // Local times resolve as PostgreSQL resolves them: a gap moves forward, an overlap takes the later offset.
        private long[] day(LocalDate date, ZoneId in) {
            long[] cells = new long[24];
            OpeningWindow window = week.get(date.getDayOfWeek());
            if (window == null) {
                return cells;
            }
            ZonedDateTime opens = ZonedDateTime.of(date, window.opensAt(), in).withLaterOffsetAtOverlap();
            Instant closes = ZonedDateTime.of(date, window.closesAt(), in).withLaterOffsetAtOverlap().toInstant();
            Instant hourStart = opens.truncatedTo(ChronoUnit.HOURS).toInstant();
            while (hourStart.isBefore(closes)) {
                Instant hourEnd = hourStart.plus(1, ChronoUnit.HOURS);
                Instant pieceStart = hourStart.isAfter(opens.toInstant()) ? hourStart : opens.toInstant();
                Instant pieceEnd = hourEnd.isBefore(closes) ? hourEnd : closes;
                if (pieceEnd.isAfter(pieceStart)) {
                    cells[hourStart.atZone(in).getHour()] += Duration.between(pieceStart, pieceEnd).toSeconds();
                }
                hourStart = hourEnd;
            }
            return cells;
        }

        private static long occurrences(DayOfWeek day, LocalDate from, LocalDate to) {
            long days = ChronoUnit.DAYS.between(from, to) + 1;
            long offset = Math.floorMod(day.getValue() - from.getDayOfWeek().getValue(), 7);
            return days <= offset ? 0 : (days - offset + 6) / 7;
        }

        private NavigableSet<LocalDate> irregularDays(LocalDate from, LocalDate to) {
            NavigableSet<LocalDate> days = new TreeSet<>();
            ZoneRules rules = zone.getRules();
            Instant end = to.plusDays(2).atStartOfDay(ZoneOffset.UTC).toInstant();
            ZoneOffsetTransition transition = rules.nextTransition(
                    from.minusDays(2).atStartOfDay(ZoneOffset.UTC).toInstant());
            while (transition != null && transition.getInstant().isBefore(end)) {
                days.add(LocalDate.ofInstant(transition.getInstant(), transition.getOffsetBefore()));
                days.add(LocalDate.ofInstant(transition.getInstant(), transition.getOffsetAfter()));
                transition = rules.nextTransition(transition.getInstant());
            }
            return days.subSet(from, true, to, true);
        }
    }
}
