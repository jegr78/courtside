package org.courtside.reporting.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminStatisticsApi;
import org.courtside.api.ApiAccountFigures;
import org.courtside.api.ApiBookingFigures;
import org.courtside.api.ApiBookingStatistics;
import org.courtside.api.ApiCardUtilisation;
import org.courtside.api.ApiCourtStatistics;
import org.courtside.api.ApiHourUtilisation;
import org.courtside.api.ApiMemberFigures;
import org.courtside.api.ApiMemberStatistics;
import org.courtside.api.ApiMembershipTypeCount;
import org.courtside.api.ApiMessageKind;
import org.courtside.api.ApiMessageKindCount;
import org.courtside.api.ApiMessageStatistics;
import org.courtside.api.ApiParticipantCardUse;
import org.courtside.api.ApiPreviousBookingFigures;
import org.courtside.api.ApiPreviousMemberFigures;
import org.courtside.api.ApiPreviousMessageCounts;
import org.courtside.api.ApiPreviousUtilisation;
import org.courtside.api.ApiStatisticsPeriod;
import org.courtside.api.ApiStatisticsRange;
import org.courtside.api.ApiUtilisationBucket;
import org.courtside.api.ApiUtilisationProgression;
import org.courtside.api.ApiUtilisationStatistics;
import org.courtside.api.ApiUtilisationTotals;
import org.courtside.booking.BookingStatistics;
import org.courtside.identity.AccountStatistics;
import org.courtside.notification.MessageStatistics;
import org.courtside.reporting.internal.StatisticsPeriod;
import org.courtside.reporting.internal.StatisticsService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequiredArgsConstructor
class StatisticsController implements AdminStatisticsApi {

    private final StatisticsService statistics;

    @Override
    public ResponseEntity<ApiStatisticsRange> readStatisticsRange() {
        StatisticsService.RangeReport range = statistics.range();
        return ResponseEntity.ok(new ApiStatisticsRange()
                .firstBookingOn(range.firstBookingOn()).today(range.today()).timeZone(range.timeZone()));
    }

    @Override
    public ResponseEntity<ApiUtilisationStatistics> readUtilisationStatistics(LocalDate from, LocalDate to) {
        StatisticsService.UtilisationReport report = statistics.utilisation(from, to);
        BookingStatistics.Utilisation utilisation = report.utilisation();
        return ResponseEntity.ok(new ApiUtilisationStatistics()
                .period(period(report.period(), report.timeZone()))
                .totals(totals(utilisation.totals()))
                .previous(report.previous() == null ? null : new ApiPreviousUtilisation()
                        .period(period(report.previous().period(), report.timeZone()))
                        .totals(totals(report.previous().figures())))
                .courts(utilisation.courts().stream().map(court -> new ApiCourtStatistics()
                        .courtId(court.courtId()).courtNumber(court.courtNumber())
                        .courtName(court.courtName()).active(court.active())
                        .bookings(court.bookings()).closedMinutes(court.closedMinutes())
                        .bookedMinutes(court.bookedMinutes()).occupancy(court.occupancy())).toList())
                .cards(utilisation.cards().stream().map(card -> new ApiCardUtilisation()
                        .cardId(card.cardId()).label(card.label()).color(card.color())
                        .closure(card.closure()).bookings(card.bookings())
                        .minutes(card.minutes())).toList())
                .hours(utilisation.hours().stream().map(hour -> new ApiHourUtilisation()
                        .isoWeekday(hour.isoWeekday()).hour(hour.hour())
                        .openMinutes(hour.openMinutes()).closedMinutes(hour.closedMinutes())
                        .bookedMinutes(hour.bookedMinutes()).occupancy(hour.occupancy())).toList())
                .progression(new ApiUtilisationProgression()
                        .granularity(ApiUtilisationProgression.GranularityEnum.fromValue(
                                utilisation.granularity().name()))
                        .buckets(utilisation.buckets().stream().map(bucket -> new ApiUtilisationBucket()
                                .startsOn(bucket.startsOn()).endsOn(bucket.endsOn())
                                .totals(totals(bucket.totals()))).toList())));
    }

    @Override
    public ResponseEntity<ApiBookingStatistics> readBookingStatistics(LocalDate from, LocalDate to) {
        StatisticsService.BookingReport report = statistics.bookings(from, to);
        return ResponseEntity.ok(new ApiBookingStatistics()
                .period(period(report.period(), report.timeZone()))
                .figures(bookingFigures(report.figures()))
                .previous(report.previous() == null ? null : new ApiPreviousBookingFigures()
                        .period(period(report.previous().period(), report.timeZone()))
                        .figures(bookingFigures(report.previous().figures())))
                .participantCards(report.participantCards().stream().map(card -> new ApiParticipantCardUse()
                        .cardId(card.cardId()).label(card.label()).uses(card.uses())).toList()));
    }

    @Override
    public ResponseEntity<ApiMemberStatistics> readMemberStatistics(LocalDate from, LocalDate to) {
        StatisticsService.MemberReport report = statistics.members(from, to);
        AccountStatistics.AccountFigures accounts = report.accounts();
        return ResponseEntity.ok(new ApiMemberStatistics()
                .period(period(report.period(), report.timeZone()))
                .figures(memberFigures(report.figures()))
                .previous(report.previous() == null ? null : new ApiPreviousMemberFigures()
                        .period(period(report.previous().period(), report.timeZone()))
                        .figures(memberFigures(report.previous().figures())))
                .membershipTypes(report.membershipTypes().stream().map(type -> new ApiMembershipTypeCount()
                        .membershipTypeId(type.membershipTypeId()).name(type.name())
                        .members(type.members())).toList())
                .accounts(new ApiAccountFigures()
                        .accounts(accounts.accounts()).passwordChosen(accounts.passwordChosen())
                        .withoutChosenPassword(accounts.withoutChosenPassword())
                        .signedInWithin30Days(accounts.signedInWithin30Days())
                        .signedInWithin90Days(accounts.signedInWithin90Days())
                        .neverSignedIn(accounts.neverSignedIn())));
    }

    @Override
    public ResponseEntity<ApiMessageStatistics> readMessageStatistics(LocalDate from, LocalDate to) {
        StatisticsService.MessageReport report = statistics.messages(from, to);
        return ResponseEntity.ok(new ApiMessageStatistics()
                .period(period(report.period(), report.timeZone()))
                .kinds(kinds(report.kinds()))
                .previous(report.previous() == null ? null : new ApiPreviousMessageCounts()
                        .period(period(report.previous().period(), report.timeZone()))
                        .kinds(kinds(report.previous().figures()))));
    }

    private static ApiStatisticsPeriod period(StatisticsPeriod period, String timeZone) {
        return new ApiStatisticsPeriod().from(period.from()).to(period.to()).timeZone(timeZone);
    }

    private static ApiUtilisationTotals totals(BookingStatistics.UtilisationTotals totals) {
        return new ApiUtilisationTotals()
                .openMinutes(totals.openMinutes()).courtCount(totals.courtCount())
                .capacityMinutes(totals.capacityMinutes()).closedMinutes(totals.closedMinutes())
                .bookedMinutes(totals.bookedMinutes()).occupancy(totals.occupancy());
    }

    private static ApiBookingFigures bookingFigures(BookingStatistics.BookingFigures figures) {
        return new ApiBookingFigures()
                .confirmed(figures.confirmed()).cancelled(figures.cancelled())
                .cancellationRate(figures.cancellationRate()).series(figures.series())
                .single(figures.single()).withGuests(figures.withGuests())
                .guestEntries(figures.guestEntries());
    }

    private static ApiMemberFigures memberFigures(StatisticsService.MemberFigures figures) {
        return new ApiMemberFigures()
                .members(figures.members()).joins(figures.joins()).leavings(figures.leavings())
                .activeMembers(figures.activeMembers()).activeShare(figures.activeShare());
    }

    private static List<ApiMessageKindCount> kinds(List<MessageStatistics.KindCount> kinds) {
        return kinds.stream().map(kind -> new ApiMessageKindCount()
                .kind(ApiMessageKind.fromValue(kind.kind().name()))
                .queued(kind.queued()).handedOver(kind.handedOver())
                .refused(kind.refused()).failed(kind.failed()).retried(kind.retried())).toList();
    }
}
