package org.courtside.notification.internal;

import org.courtside.shared.BookingAnnouncement;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class BookingCalendarTest {

    private static final Instant NOW = Instant.parse("2026-05-12T12:00:00Z");
    private static final UUID BOOKING_ID = UUID.fromString("11111111-2222-3333-4444-555555555555");
    private final BookingCalendar calendar = new BookingCalendar(Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void givenCalendarTextWithReservedCharacters_whenItIsRendered_thenItIsEscaped() {
        // given
        BookingAnnouncement booking = booking("Training; adults", "Court 1, indoor\\north\nlevel 2");

        // when
        String content = content(calendar.create(BOOKING_ID, booking, "Court 1, indoor\\north\nlevel 2"));

        // then
        assertThat(content)
                .contains("DTSTAMP:20260512T120000Z\r\n")
                .contains("SUMMARY:Training\\; adults - Court 1\\, indoor\\\\north\\nlevel 2\r\n")
                .contains("LOCATION:Court 1\\, indoor\\\\north\\nlevel 2\r\n");
    }

    @Test
    void givenALongUnicodeCourtName_whenItIsRendered_thenEveryPhysicalLineFitsTheOctetLimit() {
        // given
        BookingAnnouncement booking = booking("Member booking", "Äußeres Court mit sehr langem Namen "
                + "und weiteren mehrbytefähigen Zeichen für Kalenderprogramme");

        // when
        String content = content(calendar.create(BOOKING_ID, booking,
                "Äußeres Court mit sehr langem Namen und weiteren mehrbytefähigen Zeichen "
                        + "für Kalenderprogramme"));

        // then
        assertThat(content.split("\r\n"))
                .allSatisfy(line -> assertThat(line.getBytes(StandardCharsets.UTF_8)).hasSizeLessThanOrEqualTo(75));
        assertThat(content).contains("\r\n ");
    }

    private static BookingAnnouncement booking(String card, String court) {
        return new BookingAnnouncement(UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), List.of(),
                Instant.parse("2026-05-13T16:00:00Z"), Instant.parse("2026-05-13T17:00:00Z"),
                List.of(new BookingAnnouncement.AnnouncedCourt(1, court)), card);
    }

    private static String content(MailAttachment attachment) {
        return new String(attachment.content(), StandardCharsets.UTF_8);
    }
}
