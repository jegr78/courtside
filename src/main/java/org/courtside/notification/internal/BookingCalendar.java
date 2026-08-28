package org.courtside.notification.internal;

import org.courtside.shared.BookingAnnouncement;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
class BookingCalendar {

    private static final DateTimeFormatter UTC =
            DateTimeFormatter.ofPattern("uuuuMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
    private static final int MAX_LINE_OCTETS = 75;

    private final Clock clock;

    BookingCalendar(Clock clock) {
        this.clock = clock;
    }

    MailAttachment create(UUID bookingId, BookingAnnouncement booking, String courts) {
        List<String> lines = List.of(
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//Courtside//Booking//EN",
                "CALSCALE:GREGORIAN",
                "METHOD:PUBLISH",
                "BEGIN:VEVENT",
                "UID:booking-" + bookingId + "@courtside",
                "DTSTAMP:" + format(clock.instant()),
                "DTSTART:" + format(booking.startsAt()),
                "DTEND:" + format(booking.endsAt()),
                "SUMMARY:" + escape(booking.cardLabel() + " - " + courts),
                "LOCATION:" + escape(courts),
                "STATUS:CONFIRMED",
                "TRANSP:OPAQUE",
                "END:VEVENT",
                "END:VCALENDAR");
        String calendar = lines.stream().flatMap(line -> fold(line).stream())
                .collect(Collectors.joining("\r\n", "", "\r\n"));
        return new MailAttachment("booking.ics", "text/calendar; charset=UTF-8; method=PUBLISH",
                calendar.getBytes(StandardCharsets.UTF_8));
    }

    private static String format(Instant instant) {
        return UTC.format(instant);
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\")
                .replace(";", "\\;")
                .replace(",", "\\,")
                .replace("\r\n", "\\n")
                .replace("\n", "\\n")
                .replace("\r", "\\n");
    }

    private static List<String> fold(String line) {
        List<String> folded = new ArrayList<>();
        StringBuilder part = new StringBuilder();
        int octets = 0;
        for (int offset = 0; offset < line.length();) {
            int codePoint = line.codePointAt(offset);
            String character = new String(Character.toChars(codePoint));
            int characterOctets = character.getBytes(StandardCharsets.UTF_8).length;
            int limit = folded.isEmpty() ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
            if (octets + characterOctets > limit) {
                folded.add((folded.isEmpty() ? "" : " ") + part);
                part.setLength(0);
                octets = 0;
            }
            part.append(character);
            octets += characterOctets;
            offset += Character.charCount(codePoint);
        }
        folded.add((folded.isEmpty() ? "" : " ") + part);
        return folded;
    }
}
