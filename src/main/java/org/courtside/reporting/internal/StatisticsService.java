package org.courtside.reporting.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingStatistics;
import org.courtside.config.ClubTimeZone;
import org.courtside.identity.AccountStatistics;
import org.courtside.member.MembershipStatistics;
import org.courtside.notification.MessageStatistics;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class StatisticsService {

    // A read over a long period must give its connection back rather than hold it indefinitely.
    private static final String STATEMENT_TIMEOUT = "30s";

    private final BookingStatistics bookings;
    private final MembershipStatistics memberships;
    private final AccountStatistics accounts;
    private final MessageStatistics messages;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;
    private final JdbcClient jdbc;

    public record Compared<T>(StatisticsPeriod period, T figures) {
    }

    public record UtilisationReport(StatisticsPeriod period, String timeZone,
                                    BookingStatistics.Utilisation utilisation,
                                    Compared<BookingStatistics.UtilisationTotals> previous) {
    }

    public record BookingReport(StatisticsPeriod period, String timeZone,
                                BookingStatistics.BookingFigures figures,
                                Compared<BookingStatistics.BookingFigures> previous,
                                List<BookingStatistics.ParticipantCardUse> participantCards) {
    }

    public record MemberFigures(long members, long joins, long leavings, long activeMembers,
                                Double activeShare) {
    }

    public record MemberReport(StatisticsPeriod period, String timeZone, MemberFigures figures,
                               Compared<MemberFigures> previous,
                               List<MembershipStatistics.MembershipTypeCount> membershipTypes,
                               AccountStatistics.AccountFigures accounts) {
    }

    public record MessageReport(StatisticsPeriod period, String timeZone,
                                List<MessageStatistics.KindCount> kinds,
                                Compared<List<MessageStatistics.KindCount>> previous) {
    }

    public record RangeReport(LocalDate firstBookingOn, LocalDate today, String timeZone) {
    }

    public RangeReport range() {
        limitStatementTime();
        return new RangeReport(bookings.firstBookingOn().orElse(null),
                LocalDate.ofInstant(clock.instant(), clubTimeZone.zoneId()), timeZone());
    }

    public UtilisationReport utilisation(LocalDate from, LocalDate to) {
        StatisticsPeriod period = resolve(from, to);
        limitStatementTime();
        return new UtilisationReport(period, timeZone(),
                bookings.utilisation(period.from(), period.to()),
                previous(period, p -> bookings.utilisationTotals(p.from(), p.to())));
    }

    public BookingReport bookings(LocalDate from, LocalDate to) {
        StatisticsPeriod period = resolve(from, to);
        limitStatementTime();
        return new BookingReport(period, timeZone(),
                bookings.bookingFigures(period.from(), period.to()),
                previous(period, p -> bookings.bookingFigures(p.from(), p.to())),
                bookings.participantCardUses(period.from(), period.to()));
    }

    public MemberReport members(LocalDate from, LocalDate to) {
        StatisticsPeriod period = resolve(from, to);
        limitStatementTime();
        return new MemberReport(period, timeZone(), memberFigures(period),
                previous(period, this::memberFigures),
                memberships.runningByType(period.to()),
                accounts.figuresAsOf(period.to()));
    }

    public MessageReport messages(LocalDate from, LocalDate to) {
        StatisticsPeriod period = resolve(from, to);
        limitStatementTime();
        return new MessageReport(period, timeZone(),
                messages.queuedBetween(period.from(), period.to()),
                previous(period, p -> messages.queuedBetween(p.from(), p.to())));
    }

    private MemberFigures memberFigures(StatisticsPeriod period) {
        MembershipStatistics.MembershipFigures membership = memberships.figures(period.from(), period.to());
        long active = bookings.activeMembers(period.from(), period.to());
        return new MemberFigures(membership.running(), membership.joins(), membership.leavings(), active,
                membership.running() == 0 ? null : (double) active / membership.running());
    }

    private void limitStatementTime() {
        jdbc.sql("SET LOCAL statement_timeout = '" + STATEMENT_TIMEOUT + "'").update();
    }

    private StatisticsPeriod resolve(LocalDate from, LocalDate to) {
        return StatisticsPeriod.resolve(from, to, LocalDate.ofInstant(clock.instant(), clubTimeZone.zoneId()));
    }

    private String timeZone() {
        return clubTimeZone.zoneId().getId();
    }

    private static <T> Compared<T> previous(StatisticsPeriod period, Function<StatisticsPeriod, T> read) {
        Optional<StatisticsPeriod> previous = period.previous();
        return previous.map(p -> new Compared<>(p, read.apply(p))).orElse(null);
    }
}
