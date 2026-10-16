package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminUsageReportsApi;
import org.courtside.api.ApiAttendanceUsage;
import org.courtside.api.ApiCancellationReason;
import org.courtside.api.ApiCancellationReasonCount;
import org.courtside.api.ApiCancellationUsage;
import org.courtside.api.ApiCapacityUsage;
import org.courtside.api.ApiCapacityUse;
import org.courtside.api.ApiCardCancellations;
import org.courtside.api.ApiRuleRejectionCount;
import org.courtside.api.ApiRuleRejectionUsage;
import org.courtside.api.ApiUsageReport;
import org.courtside.booking.internal.UsageReportService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@RestController
@RequiredArgsConstructor
class UsageReportController implements AdminUsageReportsApi {

    private final UsageReportService usage;

    @Override
    public ResponseEntity<ApiUsageReport> usageReport(LocalDate from, LocalDate to) {
        UsageReportService.UsageReport report = usage.report(from, to);
        UsageReportService.Capacity capacity = report.capacity();
        UsageReportService.Cancellations cancellations = report.cancellations();
        UsageReportService.Attendance attendance = report.attendance();
        UsageReportService.RuleRejections rejections = report.ruleRejections();
        return ResponseEntity.ok(new ApiUsageReport(report.from(), report.to(), report.timeZone(),
                new ApiCapacityUsage(capacity.capacityMinutes(), capacity.closedMinutes(),
                        capacity.uses().stream().map(use -> new ApiCapacityUse(use.other(), use.cardId(), use.cardLabel(),
                                use.membershipTypeId(), use.membershipTypeName(), use.bookings(),
                                use.bookedMinutes(), use.share())).toList()),
                new ApiCancellationUsage(cancellations.cancelled(), cancellations.byHolder(),
                        cancellations.byClub(), cancellations.released(),
                        cancellations.reasons().stream().map(reason -> new ApiCancellationReasonCount(reason.cancelled())
                                .reason(reason.reason() == null ? null
                                        : ApiCancellationReason.fromValue(reason.reason().name()))).toList(),
                        cancellations.cards().stream().map(card -> new ApiCardCancellations(card.other(), card.cardId(),
                                card.cardLabel(), card.cancelled(), card.byHolder(), card.byClub(),
                                card.released())).toList()),
                new ApiAttendanceUsage(attendance.tracked(), attendance.attended(), attendance.noShows(),
                        attendance.liftedNoShows()),
                new ApiRuleRejectionUsage(rejections.attempts(), rejections.rules().stream()
                        .map(rule -> new ApiRuleRejectionCount(rule.code(), rule.attempts())).toList())));
    }
}
