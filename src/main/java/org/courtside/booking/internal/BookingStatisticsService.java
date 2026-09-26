package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingStatistics;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.Court;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningHours;
import org.courtside.shared.OpeningWindow;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
class BookingStatisticsService implements BookingStatistics {

    private static final long WEEKLY_UP_TO_DAYS = 92;

    private static final String BOUNDS = """
            bounds AS (
                SELECT timezone(:zone, CAST(:fromDay AS timestamp)) AS starts_at,
                       timezone(:zone, CAST(:toDay AS timestamp) + interval '1 day') AS ends_at
            )""";

    private static final String BOOKINGS_STARTING_IN_THE_PERIOD = BOUNDS + """
            ,
            started AS (
                SELECT b.id, b.status, b.series_id, b.booked_by
                FROM booking b
                WHERE b.card_id <> :closure
                  AND b.id IN (SELECT a.booking_id FROM court_allocation a
                               WHERE a.starts_at >= timezone(:zone, CAST(:fromDay AS timestamp))
                                 AND a.starts_at < timezone(:zone, CAST(:toDay AS timestamp) + interval '1 day'))
                  AND NOT EXISTS (SELECT 1 FROM court_allocation e
                                  WHERE e.booking_id = b.id
                                    AND e.starts_at < timezone(:zone, CAST(:fromDay AS timestamp)))
            )""";

    private static final String UTILISATION = "WITH " + BOUNDS + """
            ,
            held AS (
                SELECT a.booking_id, a.court_id, b.card_id, b.card_id = :closure AS closure,
                       GREATEST(a.starts_at, bounds.starts_at) AS starts_at,
                       LEAST(a.ends_at, bounds.ends_at) AS ends_at
                FROM court_allocation a
                JOIN booking b ON b.id = a.booking_id
                CROSS JOIN bounds
                WHERE a.status <> 'CANCELLED'
                  AND tstzrange(a.starts_at, a.ends_at, '[)')
                      && tstzrange(timezone(:zone, CAST(:fromDay AS timestamp)),
                                   timezone(:zone, CAST(:toDay AS timestamp) + interval '1 day'), '[)')
            ),
            opened AS (
                SELECT h.booking_id, h.court_id, h.card_id, h.closure,
                       GREATEST(h.starts_at, w.opens_at) AS starts_at,
                       LEAST(h.ends_at, w.closes_at) AS ends_at
                FROM held h
                CROSS JOIN LATERAL generate_series(
                    CAST(CAST(timezone(:zone, h.starts_at) AS date) AS timestamp),
                    CAST(CAST(timezone(:zone, h.ends_at) AS date) AS timestamp),
                    interval '1 day') AS day(local_day)
                CROSS JOIN LATERAL (
                    SELECT timezone(:zone, CAST(day.local_day AS date) + o.opens_at) AS opens_at,
                           timezone(:zone, CAST(day.local_day AS date) + o.closes_at) AS closes_at
                    FROM opening_hours o
                    WHERE o.day_of_week = EXTRACT(ISODOW FROM day.local_day)
                ) w
                WHERE GREATEST(h.starts_at, w.opens_at) < LEAST(h.ends_at, w.closes_at)
            ),
            pieces AS (
                SELECT o.booking_id, o.court_id, o.card_id, o.closure,
                       timezone(:zone, hour.starts_at) AS local_hour,
                       EXTRACT(EPOCH FROM LEAST(o.ends_at, hour.starts_at + interval '1 hour')
                                          - GREATEST(o.starts_at, hour.starts_at)) AS seconds
                FROM opened o
                CROSS JOIN LATERAL generate_series(date_trunc('hour', o.starts_at, :zone),
                    o.ends_at - interval '1 microsecond', interval '1 hour') AS hour(starts_at)
            ),
            cells AS (
                SELECT court_id, card_id, closure, seconds,
                       CAST(EXTRACT(ISODOW FROM local_hour) AS integer) AS weekday,
                       CAST(EXTRACT(HOUR FROM local_hour) AS integer) AS hour,
                       CAST(date_trunc(:granularity, local_hour) AS date) AS bucket
                FROM pieces
            )
            SELECT CASE WHEN GROUPING(court_id) = 0 THEN 'COURT'
                        WHEN GROUPING(card_id) = 0 THEN 'CARD'
                        WHEN GROUPING(weekday) = 0 THEN 'HOUR'
                        ELSE 'BUCKET' END AS dimension,
                   court_id, card_id, weekday, hour, bucket, closure,
                   CAST(FLOOR(SUM(seconds) / 60) AS bigint) AS minutes, CAST(0 AS bigint) AS bookings
            FROM cells
            GROUP BY GROUPING SETS ((court_id, closure), (card_id), (weekday, hour, closure),
                                   (bucket, closure))
            UNION ALL
            SELECT 'COURT', court_id, NULL, NULL, NULL, NULL, closure, 0, COUNT(*)
            FROM (SELECT DISTINCT court_id, closure, booking_id FROM held) per_court
            GROUP BY court_id, closure
            UNION ALL
            SELECT 'CARD', NULL, card_id, NULL, NULL, NULL, closure, 0, COUNT(*)
            FROM (SELECT DISTINCT card_id, closure, booking_id FROM held) per_card
            GROUP BY card_id, closure
            """;

    private static final String RETIRED_COURTS_HELD = "WITH " + BOUNDS + """
            ,
            held AS (
                SELECT a.court_id, GREATEST(a.starts_at, bounds.starts_at) AS starts_at,
                       LEAST(a.ends_at, bounds.ends_at) AS ends_at
                FROM court_allocation a
                JOIN court c ON c.id = a.court_id AND NOT c.active
                CROSS JOIN bounds
                WHERE a.status = 'CONFIRMED'
                  AND a.starts_at < bounds.ends_at
                  AND a.ends_at > bounds.starts_at
            )
            SELECT DISTINCT h.court_id, CAST(bucket.starts_on AS date) AS bucket
            FROM held h
            CROSS JOIN LATERAL generate_series(
                date_trunc(:granularity, timezone(:zone, h.starts_at)),
                timezone(:zone, h.ends_at - interval '1 microsecond'),
                CAST('1 ' || :granularity AS interval)) AS bucket(starts_on)
            """;

    private final JdbcClient jdbc;
    private final FacilityService facility;
    private final CardService cards;
    private final ClubTimeZone clubTimeZone;

    @Override
    public Optional<LocalDate> firstBookingOn() {
        List<LocalDate> first = jdbc.sql(
                        "SELECT CAST(timezone(:zone, MIN(starts_at)) AS date) AS first FROM court_allocation")
                .param("zone", clubTimeZone.zoneId().getId())
                .query((rs, row) -> rs.getObject("first", LocalDate.class))
                .list();
        return Optional.ofNullable(first.getFirst());
    }

    @Override
    public Utilisation utilisation(LocalDate from, LocalDate to) {
        requirePeriod(from, to);
        Granularity granularity = ChronoUnit.DAYS.between(from, to) + 1 <= WEEKLY_UP_TO_DAYS
                ? Granularity.WEEK : Granularity.MONTH;
        List<Fact> facts = facts(from, to, granularity);
        OpenTimeCalendar calendar = calendar();
        List<Court> courts = facility.allCourts().stream()
                .sorted(Comparator.comparingInt(Court::getNumber)).toList();
        long openMinutes = calendar.openSeconds(from, to) / 60;
        int courtCount = countedCourts(courts, facts);
        return new Utilisation(
                totals(openMinutes, courtCount, facts, "COURT"),
                courtFigures(courts, openMinutes, facts),
                cardFigures(facts),
                hourFigures(calendar.hourSeconds(from, to), courtCount, facts),
                granularity,
                buckets(from, to, granularity, calendar, activeCourts(courts),
                        courts.stream().allMatch(Court::isActive)
                                ? Map.of() : retiredCourtsByBucket(from, to, granularity), facts));
    }

    @Override
    public UtilisationTotals utilisationTotals(LocalDate from, LocalDate to) {
        requirePeriod(from, to);
        long openMinutes = calendar().openSeconds(from, to) / 60;
        List<Fact> facts = facts(from, to, Granularity.WEEK);
        return totals(openMinutes, countedCourts(facility.allCourts(), facts), facts, "COURT");
    }

    @Override
    public BookingFigures bookingFigures(LocalDate from, LocalDate to) {
        requirePeriod(from, to);
        return jdbc.sql("WITH " + BOOKINGS_STARTING_IN_THE_PERIOD + """
                        SELECT COUNT(*) FILTER (WHERE s.status = 'CONFIRMED') AS confirmed,
                               COUNT(*) FILTER (WHERE s.status = 'CANCELLED') AS cancelled,
                               COUNT(*) FILTER (WHERE s.status = 'CONFIRMED'
                                                  AND s.series_id IS NOT NULL) AS series,
                               COUNT(*) FILTER (WHERE s.status = 'CONFIRMED'
                                                  AND g.entries > 0) AS with_guests,
                               COALESCE(SUM(g.entries) FILTER (WHERE s.status = 'CONFIRMED'), 0)
                                   AS guest_entries
                        FROM started s
                        CROSS JOIN LATERAL (
                            SELECT COUNT(*) AS entries FROM booking_participant p
                            WHERE p.booking_id = s.id AND p.kind = 'GUEST'
                        ) g
                        """)
                .params(periodParameters(from, to))
                .query((rs, row) -> {
                    long confirmed = rs.getLong("confirmed");
                    long cancelled = rs.getLong("cancelled");
                    long series = rs.getLong("series");
                    return new BookingFigures(confirmed, cancelled, share(cancelled, confirmed + cancelled),
                            series, confirmed - series, rs.getLong("with_guests"),
                            rs.getLong("guest_entries"));
                })
                .single();
    }

    @Override
    public List<ParticipantCardUse> participantCardUses(LocalDate from, LocalDate to) {
        requirePeriod(from, to);
        Map<UUID, Long> uses = new HashMap<>();
        jdbc.sql("WITH " + BOOKINGS_STARTING_IN_THE_PERIOD + """
                        SELECT p.card_id, COUNT(*) AS uses
                        FROM started s
                        JOIN booking_participant p ON p.booking_id = s.id
                        WHERE s.status = 'CONFIRMED' AND p.kind = 'CARD'
                        GROUP BY p.card_id
                        """)
                .params(periodParameters(from, to))
                .query(rs -> {
                    uses.put(rs.getObject("card_id", UUID.class), rs.getLong("uses"));
                });
        return cards.allParticipantCards().stream()
                .sorted(Comparator.comparing(ParticipantCard::getLabel))
                .map(card -> new ParticipantCardUse(card.getId(), card.getLabel(),
                        uses.getOrDefault(card.getId(), 0L)))
                .toList();
    }

    @Override
    public long activeMembers(LocalDate from, LocalDate to) {
        requirePeriod(from, to);
        return jdbc.sql("WITH " + BOOKINGS_STARTING_IN_THE_PERIOD + """
                        ,
                        players AS (
                            SELECT u.person_id FROM started s
                            JOIN user_account u ON u.id = s.booked_by
                            WHERE s.status = 'CONFIRMED'
                            UNION
                            SELECT p.person_id FROM started s
                            JOIN booking_participant p ON p.booking_id = s.id
                            WHERE s.status = 'CONFIRMED' AND p.kind = 'MEMBER'
                        )
                        SELECT COUNT(*) FROM member m
                        WHERE m.person_id IN (SELECT person_id FROM players)
                          AND m.started_on <= :toDay
                          AND (m.ended_on IS NULL OR m.ended_on > :toDay)
                        """)
                .params(periodParameters(from, to))
                .query(Long.class)
                .single();
    }

    private List<Fact> facts(LocalDate from, LocalDate to, Granularity granularity) {
        // The planner cannot size the generated series, and compiling for its estimate costs more than the query.
        jdbc.sql("SET LOCAL jit = off").update();
        Map<String, Object> parameters = new HashMap<>(periodParameters(from, to));
        parameters.put("granularity", granularity == Granularity.WEEK ? "week" : "month");
        return jdbc.sql(UTILISATION).params(parameters).query(BookingStatisticsService::fact).list();
    }

    // A court counts where it is active now or held a confirmed allocation, since no availability is dated.
    private static int countedCourts(List<Court> courts, List<Fact> facts) {
        Set<UUID> held = facts.stream().filter(fact -> fact.dimension().equals("COURT"))
                .map(Fact::courtId).collect(Collectors.toSet());
        return (int) courts.stream().filter(court -> court.isActive() || held.contains(court.getId())).count();
    }

    private static int activeCourts(List<Court> courts) {
        return (int) courts.stream().filter(Court::isActive).count();
    }

    private Map<LocalDate, Long> retiredCourtsByBucket(LocalDate from, LocalDate to, Granularity granularity) {
        Map<String, Object> parameters = new HashMap<>(periodParameters(from, to));
        parameters.put("granularity", granularity == Granularity.WEEK ? "week" : "month");
        return jdbc.sql(RETIRED_COURTS_HELD).params(parameters)
                .query((rs, row) -> rs.getObject("bucket", LocalDate.class)).list().stream()
                .collect(Collectors.groupingBy(bucket -> bucket, Collectors.counting()));
    }

    private Map<String, Object> periodParameters(LocalDate from, LocalDate to) {
        return Map.of("zone", clubTimeZone.zoneId().getId(), "fromDay", from, "toDay", to,
                "closure", BookingCard.COURT_CLOSED);
    }

    private static Fact fact(ResultSet rs, int row) throws SQLException {
        return new Fact(rs.getString("dimension"), rs.getObject("court_id", UUID.class),
                rs.getObject("card_id", UUID.class), rs.getObject("weekday", Integer.class),
                rs.getObject("hour", Integer.class), rs.getObject("bucket", LocalDate.class),
                Boolean.TRUE.equals(rs.getObject("closure", Boolean.class)),
                rs.getLong("minutes"), rs.getLong("bookings"));
    }

    private OpenTimeCalendar calendar() {
        Map<DayOfWeek, OpeningWindow> week = facility.allOpeningHours().stream()
                .collect(Collectors.toMap(OpeningHours::getDayOfWeek,
                        hours -> new OpeningWindow(hours.getOpensAt(), hours.getClosesAt())));
        return new OpenTimeCalendar(week, clubTimeZone.zoneId());
    }

    private static UtilisationTotals totals(long openMinutes, int courtCount, List<Fact> facts,
                                            String dimension) {
        long closed = 0;
        long booked = 0;
        for (Fact fact : facts) {
            if (!fact.dimension().equals(dimension)) {
                continue;
            }
            if (fact.closure()) {
                closed += fact.minutes();
            } else {
                booked += fact.minutes();
            }
        }
        long capacity = openMinutes * courtCount;
        return new UtilisationTotals(openMinutes, courtCount, capacity, closed, booked,
                share(booked, capacity - closed));
    }

    private static List<CourtFigures> courtFigures(List<Court> courts, long openMinutes, List<Fact> facts) {
        return courts.stream().map(court -> {
            long bookings = 0;
            long closed = 0;
            long booked = 0;
            for (Fact fact : facts) {
                if (!fact.dimension().equals("COURT") || !court.getId().equals(fact.courtId())) {
                    continue;
                }
                if (fact.closure()) {
                    closed += fact.minutes();
                } else {
                    booked += fact.minutes();
                    bookings += fact.bookings();
                }
            }
            return new CourtFigures(court.getId(), court.getNumber(), court.getName(), court.isActive(),
                    bookings, closed, booked, share(booked, openMinutes - closed));
        }).toList();
    }

    private List<CardFigures> cardFigures(List<Fact> facts) {
        Map<UUID, List<Fact>> byCard = facts.stream().filter(fact -> fact.dimension().equals("CARD"))
                .collect(Collectors.groupingBy(Fact::cardId));
        return cards.allCards().stream()
                .sorted(Comparator.comparing(BookingCard::getLabel))
                .map(card -> {
                    List<Fact> rows = byCard.getOrDefault(card.getId(), List.of());
                    return new CardFigures(card.getId(), card.getLabel(), card.getColor(),
                            BookingCard.COURT_CLOSED.equals(card.getId()),
                            rows.stream().mapToLong(Fact::bookings).sum(),
                            rows.stream().mapToLong(Fact::minutes).sum());
                })
                .toList();
    }

    private static List<HourFigures> hourFigures(long[][] openSeconds, int courtCount, List<Fact> facts) {
        long[][] closed = new long[7][24];
        long[][] booked = new long[7][24];
        for (Fact fact : facts) {
            if (!fact.dimension().equals("HOUR") || fact.weekday() == null) {
                continue;
            }
            long[][] target = fact.closure() ? closed : booked;
            target[fact.weekday() - 1][fact.hour()] += fact.minutes();
        }
        List<HourFigures> hours = new ArrayList<>(7 * 24);
        for (int day = 0; day < 7; day++) {
            for (int hour = 0; hour < 24; hour++) {
                long open = openSeconds[day][hour] / 60;
                hours.add(new HourFigures(day + 1, hour, open, closed[day][hour], booked[day][hour],
                        share(booked[day][hour], open * courtCount - closed[day][hour])));
            }
        }
        return hours;
    }

    private static List<Bucket> buckets(LocalDate from, LocalDate to, Granularity granularity,
                                        OpenTimeCalendar calendar, int activeCourts,
                                        Map<LocalDate, Long> retiredCourts, List<Fact> facts) {
        Map<LocalDate, List<Fact>> byBucket = facts.stream()
                .filter(fact -> fact.dimension().equals("BUCKET") && fact.bucket() != null)
                .collect(Collectors.groupingBy(Fact::bucket));
        List<Bucket> buckets = new ArrayList<>();
        LocalDate startsOn = from;
        while (!startsOn.isAfter(to)) {
            LocalDate key = granularity == Granularity.WEEK
                    ? startsOn.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                    : startsOn.withDayOfMonth(1);
            LocalDate last = granularity == Granularity.WEEK
                    ? key.plusDays(6) : key.with(TemporalAdjusters.lastDayOfMonth());
            LocalDate endsOn = last.isAfter(to) ? to : last;
            int courtCount = activeCourts + retiredCourts.getOrDefault(key, 0L).intValue();
            buckets.add(new Bucket(startsOn, endsOn, totals(calendar.openSeconds(startsOn, endsOn) / 60,
                    courtCount, byBucket.getOrDefault(key, List.of()), "BUCKET")));
            startsOn = endsOn.plusDays(1);
        }
        return buckets;
    }

    private static Double share(long part, long whole) {
        return whole <= 0 ? null : (double) part / whole;
    }

    private static void requirePeriod(LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from)) {
            throw new IllegalStateException("Statistics need a resolved period");
        }
    }

    private record Fact(String dimension, UUID courtId, UUID cardId, Integer weekday, Integer hour,
                        LocalDate bucket, boolean closure, long minutes, long bookings) {
    }
}
