package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.BookingLedger;
import org.courtside.dataexchange.SupportedEncodings;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;

@Service
@RequiredArgsConstructor
public class BookingExportService {

    private static final List<String> HEADER =
            List.of("date", "startsAt", "endsAt", "courtNumber", "courtName", "card");

    private final BookingLedger ledger;

    public byte[] bookings(LocalDate from, LocalDate to, char separator, String encoding) {
        RosterExportService.requireUsableSeparator(separator);
        List<List<String>> rows = ledger.confirmedBetween(from, to).stream()
                .map(BookingExportService::cells)
                .toList();
        return ExportCsv.write(HEADER, rows, separator, SupportedEncodings.forWriting(encoding));
    }

    private static List<String> cells(BookingLedger.Occupancy occupancy) {
        return Arrays.asList(occupancy.date().toString(), occupancy.startsAt().toString(),
                occupancy.endsAt().toString(), String.valueOf(occupancy.courtNumber()),
                occupancy.courtName(), occupancy.card());
    }
}
