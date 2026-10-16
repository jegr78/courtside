package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingStatistics;
import org.courtside.card.BookingCard;
import org.courtside.config.ClubTimeZone;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.DatabaseDeadlines;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true, timeoutString = DatabaseDeadlines.REPORT)
public class UsageReportService {

    static final int MINIMUM_GROUP_ACCOUNTS = 3;

    private static final String STARTED = """
            WITH started AS (
                SELECT b.id, b.card_id, b.status, b.booked_by, b.cancelled_by, b.cancellation_reason,
                       (SELECT MIN(f.starts_at) FROM court_allocation f WHERE f.booking_id = b.id) AS first_start
                FROM booking b
                WHERE b.card_id <> :closure
                  AND b.id IN (SELECT a.booking_id FROM court_allocation a
                               WHERE a.starts_at >= :startsAt AND a.starts_at < :endsAt)
                  AND NOT EXISTS (SELECT 1 FROM court_allocation e
                                  WHERE e.booking_id = b.id AND e.starts_at < :startsAt)
            )
            """;

    private final JdbcClient jdbc;
    private final BookingStatistics statistics;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;

    public UsageReport report(LocalDate from, LocalDate to) {
        ZoneId zone = clubTimeZone.zoneId();
        ReportingPeriod period = ReportingPeriod.resolve(from, to, LocalDate.ofInstant(clock.instant(), zone));
        Map<String, Object> bounds = bounds(period, zone);
        BookingStatistics.UtilisationTotals totals = statistics.utilisationTotals(period.from(), period.to());
        return new UsageReport(period.from(), period.to(), zone.getId(),
                new Capacity(totals.capacityMinutes(), totals.closedMinutes(),
                        capacityUses(bounds, totals.capacityMinutes() - totals.closedMinutes())),
                cancellations(bounds), attendance(bounds), ruleRejections(bounds));
    }

    private List<CapacityUse> capacityUses(Map<String, Object> bounds, long bookableMinutes) {
        List<Grouped<CapacityUse>> groups = jdbc.sql(STARTED + """
                        SELECT s.card_id, c.label, m.membership_type_id, t.name,
                               COUNT(DISTINCT s.id) AS bookings, COUNT(DISTINCT s.booked_by) AS accounts,
                               CAST(FLOOR(SUM(EXTRACT(EPOCH FROM a.ends_at - a.starts_at)) / 60) AS bigint) AS minutes
                        FROM started s
                        JOIN booking_card c ON c.id = s.card_id
                        JOIN court_allocation a ON a.booking_id = s.id
                        LEFT JOIN user_account u ON u.id = s.booked_by
                        LEFT JOIN member m ON m.person_id = u.person_id
                             AND m.started_on <= CAST(timezone(:zone, s.first_start) AS date)
                             AND (m.ended_on IS NULL OR m.ended_on > CAST(timezone(:zone, s.first_start) AS date))
                        LEFT JOIN membership_type t ON t.id = m.membership_type_id
                        WHERE s.status = 'CONFIRMED'
                        GROUP BY s.card_id, c.label, m.membership_type_id, t.name
                        ORDER BY c.label, t.name NULLS LAST
                        """)
                .params(bounds)
                .query((rs, row) -> new Grouped<>(rs.getLong("accounts"), new CapacityUse(false,
                        rs.getObject("card_id", UUID.class), rs.getString("label"),
                        rs.getObject("membership_type_id", UUID.class), rs.getString("name"),
                        rs.getLong("bookings"), rs.getLong("minutes"), null)))
                .list();
        List<CapacityUse> uses = new ArrayList<>();
        long otherBookings = 0;
        long otherMinutes = 0;
        boolean other = false;
        for (Grouped<CapacityUse> group : groups) {
            if (group.accounts() >= MINIMUM_GROUP_ACCOUNTS) {
                uses.add(group.row().withShare(share(group.row().bookedMinutes(), bookableMinutes)));
            } else {
                other = true;
                otherBookings += group.row().bookings();
                otherMinutes += group.row().bookedMinutes();
            }
        }
        if (other) {
            uses.add(new CapacityUse(true, null, null, null, null, otherBookings, otherMinutes,
                    share(otherMinutes, bookableMinutes)));
        }
        return uses;
    }

    private static Double share(long minutes, long bookableMinutes) {
        return bookableMinutes <= 0 ? null : (double) minutes / bookableMinutes;
    }

    private Cancellations cancellations(Map<String, Object> bounds) {
        List<Grouped<CardCancellations>> grouped = jdbc.sql(STARTED + """
                        SELECT s.card_id, c.label, COUNT(*) AS cancelled, COUNT(DISTINCT s.booked_by) AS accounts,
                               COUNT(*) FILTER (WHERE r.booking_id IS NOT NULL) AS released,
                               COUNT(*) FILTER (WHERE r.booking_id IS NULL AND s.cancelled_by IS NOT NULL
                                                  AND s.cancelled_by = s.booked_by) AS by_holder
                        FROM started s
                        JOIN booking_card c ON c.id = s.card_id
                        LEFT JOIN booking_release r ON r.booking_id = s.id
                        WHERE s.status = 'CANCELLED'
                        GROUP BY s.card_id, c.label
                        ORDER BY c.label
                        """)
                .params(bounds)
                .query((rs, row) -> {
                    long cancelled = rs.getLong("cancelled");
                    long released = rs.getLong("released");
                    long byHolder = rs.getLong("by_holder");
                    return new Grouped<>(rs.getLong("accounts"), new CardCancellations(false,
                            rs.getObject("card_id", UUID.class), rs.getString("label"),
                            cancelled, byHolder, cancelled - released - byHolder, released));
                })
                .list();
        List<CardCancellations> cards = new ArrayList<>();
        CardCancellations other = null;
        for (Grouped<CardCancellations> group : grouped) {
            if (group.accounts() >= MINIMUM_GROUP_ACCOUNTS) {
                cards.add(group.row());
            } else {
                other = group.row().joining(other);
            }
        }
        if (other != null) {
            cards.add(other);
        }
        List<ReasonCount> reasons = jdbc.sql(STARTED + """
                        SELECT s.cancellation_reason, COUNT(*) AS cancelled
                        FROM started s
                        LEFT JOIN booking_release r ON r.booking_id = s.id
                        WHERE s.status = 'CANCELLED' AND r.booking_id IS NULL
                          AND (s.cancelled_by IS NULL OR s.cancelled_by IS DISTINCT FROM s.booked_by)
                        GROUP BY s.cancellation_reason
                        ORDER BY s.cancellation_reason NULLS LAST
                        """)
                .params(bounds)
                .query((rs, row) -> {
                    String reason = rs.getString("cancellation_reason");
                    return new ReasonCount(reason == null ? null : CancellationReason.valueOf(reason),
                            rs.getLong("cancelled"));
                })
                .list();
        return new Cancellations(
                cards.stream().mapToLong(CardCancellations::cancelled).sum(),
                cards.stream().mapToLong(CardCancellations::byHolder).sum(),
                cards.stream().mapToLong(CardCancellations::byClub).sum(),
                cards.stream().mapToLong(CardCancellations::released).sum(),
                reasons, cards);
    }

    private Attendance attendance(Map<String, Object> bounds) {
        boolean tracked = jdbc.sql("SELECT COALESCE(bool_or(enabled), false) FROM attendance_policy")
                .query(Boolean.class).single();
        return jdbc.sql(STARTED + """
                        SELECT COUNT(*) FILTER (WHERE x.outcome = 'ATTENDED') AS attended,
                               COUNT(*) FILTER (WHERE x.outcome = 'NO_SHOW' AND x.lifted_at IS NULL) AS no_shows,
                               COUNT(*) FILTER (WHERE x.outcome = 'NO_SHOW' AND x.lifted_at IS NOT NULL) AS lifted
                        FROM started s
                        JOIN booking_attendance x ON x.booking_id = s.id
                        """)
                .params(bounds)
                .query((rs, row) -> new Attendance(tracked, rs.getLong("attended"), rs.getLong("no_shows"),
                        rs.getLong("lifted")))
                .single();
    }

    private RuleRejections ruleRejections(Map<String, Object> bounds) {
        long attempts = jdbc.sql("""
                        SELECT COUNT(DISTINCT attempt_id) FROM booking_rule_rejection
                        WHERE rejected_at >= :startsAt AND rejected_at < :endsAt
                        """)
                .params(bounds).query(Long.class).single();
        List<RuleCount> rules = jdbc.sql("""
                        SELECT rule_code, COUNT(DISTINCT attempt_id) AS attempts FROM booking_rule_rejection
                        WHERE rejected_at >= :startsAt AND rejected_at < :endsAt
                        GROUP BY rule_code
                        ORDER BY attempts DESC, rule_code
                        """)
                .params(bounds)
                .query((rs, row) -> new RuleCount(rs.getString("rule_code"), rs.getLong("attempts")))
                .list();
        return new RuleRejections(attempts, rules);
    }

    private static Map<String, Object> bounds(ReportingPeriod period, ZoneId zone) {
        Map<String, Object> bounds = new HashMap<>();
        bounds.put("zone", zone.getId());
        bounds.put("closure", BookingCard.COURT_CLOSED);
        bounds.put("startsAt", Timestamp.from(period.from().atStartOfDay(zone).toInstant()));
        bounds.put("endsAt", Timestamp.from(period.to().plusDays(1).atStartOfDay(zone).toInstant()));
        return bounds;
    }

    public record UsageReport(LocalDate from, LocalDate to, String timeZone, Capacity capacity,
                              Cancellations cancellations, Attendance attendance, RuleRejections ruleRejections) {
    }

    public record Capacity(long capacityMinutes, long closedMinutes, List<CapacityUse> uses) {
    }

    public record CapacityUse(boolean other, UUID cardId, String cardLabel, UUID membershipTypeId,
                              String membershipTypeName, long bookings, long bookedMinutes, Double share) {

        CapacityUse withShare(Double value) {
            return new CapacityUse(other, cardId, cardLabel, membershipTypeId, membershipTypeName, bookings,
                    bookedMinutes, value);
        }
    }

    public record Cancellations(long cancelled, long byHolder, long byClub, long released,
                                List<ReasonCount> reasons, List<CardCancellations> cards) {
    }

    public record ReasonCount(CancellationReason reason, long cancelled) {
    }

    public record CardCancellations(boolean other, UUID cardId, String cardLabel, long cancelled, long byHolder,
                                    long byClub, long released) {

        CardCancellations joining(CardCancellations sum) {
            return sum == null
                    ? new CardCancellations(true, null, null, cancelled, byHolder, byClub, released)
                    : new CardCancellations(true, null, null, sum.cancelled + cancelled, sum.byHolder + byHolder,
                    sum.byClub + byClub, sum.released + released);
        }
    }

    private record Grouped<T>(long accounts, T row) {
    }

    public record Attendance(boolean tracked, long attended, long noShows, long liftedNoShows) {
    }

    public record RuleRejections(long attempts, List<RuleCount> rules) {
    }

    public record RuleCount(String code, long attempts) {
    }
}
