package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminExportApi;
import org.courtside.api.ApiRosterExportRequest;
import org.courtside.config.ClubTimeZone;
import org.courtside.dataexchange.SupportedEncodings;
import org.courtside.dataexchange.internal.BookingExportService;
import org.courtside.dataexchange.internal.LogExportService;
import org.courtside.dataexchange.internal.RosterExportService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.io.InputStream;
import java.nio.charset.Charset;
import java.time.Clock;
import java.time.LocalDate;

@RestController
@RequiredArgsConstructor
class ExportAdminController implements AdminExportApi {

    private final RosterExportService rosterExports;
    private final BookingExportService bookingExports;
    private final LogExportService logExports;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;

    @Override
    public ResponseEntity<Resource> exportRoster(ApiRosterExportRequest request) {
        String encoding = request.getEncoding();
        byte[] file = rosterExports.roster(request.getQuery(), request.getMembershipTypeId(),
                request.getSourceId(), request.getSeparator().charAt(0), encoding);
        return offered("roster-%s".formatted(today()), file, SupportedEncodings.forWriting(encoding));
    }

    @Override
    public ResponseEntity<Resource> exportBookings(LocalDate from, LocalDate to, String separator,
                                                   String encoding) {
        byte[] file = bookingExports.bookings(from, to, separator.charAt(0), encoding);
        return offered("bookings-%s-%s".formatted(from, to), file,
                SupportedEncodings.forWriting(encoding));
    }

    @Override
    public ResponseEntity<Resource> exportAuditLog(LocalDate from, LocalDate to, String separator,
                                                   String encoding) {
        InputStream file = logExports.auditLog(from, to, separator.charAt(0), encoding);
        return streamed("audit-log-%s".formatted(today()), file, SupportedEncodings.forWriting(encoding));
    }

    @Override
    public ResponseEntity<Resource> exportMessageLog(LocalDate from, LocalDate to, String separator,
                                                     String encoding) {
        InputStream file = logExports.messageLog(from, to, separator.charAt(0), encoding);
        return streamed("message-log-%s".formatted(today()), file, SupportedEncodings.forWriting(encoding));
    }

    private LocalDate today() {
        return LocalDate.now(clock.withZone(clubTimeZone.zoneId()));
    }

    // The name is built here and never from anything a club typed, because a header carrying a
    // club's own text is a header a caller can put a line break into.
    private ResponseEntity<Resource> offered(String what, byte[] file, Charset charset) {
        return attachment(what, charset).body(new ByteArrayResource(file));
    }

    private ResponseEntity<Resource> streamed(String what, InputStream file, Charset charset) {
        return attachment(what, charset).body(new InputStreamResource(file));
    }

    private static ResponseEntity.BodyBuilder attachment(String what, Charset charset) {
        String name = "%s.csv".formatted(what);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"%s\"".formatted(name))
                .contentType(new MediaType("text", "csv", charset));
    }
}
