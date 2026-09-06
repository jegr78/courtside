package org.courtside.dataexchange.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminExportApi;
import org.courtside.config.ClubTimeZone;
import org.courtside.dataexchange.SupportedEncodings;
import org.courtside.dataexchange.internal.RosterExportService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.Charset;
import java.time.Clock;
import java.time.LocalDate;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
class ExportAdminController implements AdminExportApi {

    private final RosterExportService exports;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;

    @Override
    public ResponseEntity<Resource> exportRoster(String query, UUID membershipTypeId, UUID sourceId,
                                                 String separator, String encoding) {
        byte[] file = exports.roster(query, membershipTypeId, sourceId, separator.charAt(0), encoding);
        return offered("roster", file, SupportedEncodings.resolve(encoding));
    }

    // The name is built here and never from anything a club typed, because a header carrying a
    // club's own text is a header a caller can put a line break into.
    private ResponseEntity<Resource> offered(String what, byte[] file, Charset charset) {
        String name = "%s-%s.csv".formatted(what, LocalDate.now(clock.withZone(clubTimeZone.zoneId())));
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"%s\"".formatted(name))
                .contentType(new MediaType("text", "csv", charset))
                .body(new ByteArrayResource(file));
    }
}
