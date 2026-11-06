package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiGuestFeeMember;
import org.courtside.api.ApiGuestFeeMemberNumber;
import org.courtside.api.ApiGuestFeeReport;
import org.courtside.api.ApiGuestFeeSource;
import org.courtside.api.TreasuryApi;
import org.courtside.dataexchange.SupportedEncodings;
import org.courtside.dataexchange.internal.GuestFeeReportService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@RestController
@RequiredArgsConstructor
class TreasuryController implements TreasuryApi {

    private final GuestFeeReportService guestFees;

    @Override
    public ResponseEntity<ApiGuestFeeReport> reportGuestFees(LocalDate from, LocalDate to) {
        GuestFeeReportService.Report report = guestFees.report(from, to);
        return ResponseEntity.ok(new ApiGuestFeeReport(report.from(), report.to(),
                report.sources().stream().map(source -> new ApiGuestFeeSource(source.id(), source.displayName()))
                        .toList(),
                report.rows().stream().map(TreasuryController::member).toList(),
                report.unassignedGuestPlaces()));
    }

    @Override
    public ResponseEntity<Resource> exportGuestFees(LocalDate from, LocalDate to, String separator,
                                                    String encoding) {
        GuestFeeReportService.Download file = guestFees.file(from, to, separator.charAt(0), encoding);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"guest-fees-%s-%s.csv\"".formatted(file.from(), file.to()))
                .contentType(new MediaType("text", "csv", SupportedEncodings.forWriting(encoding)))
                .body(new ByteArrayResource(file.content()));
    }

    private static ApiGuestFeeMember member(GuestFeeReportService.Row row) {
        return new ApiGuestFeeMember(row.personId(), row.firstName(), row.lastName(), row.email(),
                row.references().stream()
                        .map(reference -> new ApiGuestFeeMemberNumber(reference.sourceId(), reference.externalId()))
                        .toList(),
                row.currency(), row.guestPlaces(), row.sumMinor());
    }
}
