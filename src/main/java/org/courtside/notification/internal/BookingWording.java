package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.shared.BookingAnnouncement;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class BookingWording {

    private final ClubIdentity club;
    private final MailTemplates templates;

    Map<String, String> of(BookingAnnouncement booking, Locale locale) {
        return Map.of(
                "clubName", club.clubName(),
                "day", day(booking.startsAt(), locale),
                "from", time(booking.startsAt()),
                "to", time(booking.endsAt()),
                "courts", courts(booking, locale),
                "card", booking.cardLabel());
    }

    private String courts(BookingAnnouncement booking, Locale locale) {
        return booking.courts().stream()
                .map(court -> court.name() == null || court.name().isBlank()
                        ? templates.render("booking.court", locale,
                                Map.of("number", String.valueOf(court.number())))
                        : court.name())
                .collect(Collectors.joining(", "));
    }

    private String day(Instant startsAt, Locale locale) {
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)
                .format(ZonedDateTime.ofInstant(startsAt, club.zoneId()));
    }

    private String time(Instant instant) {
        return DateTimeFormatter.ofPattern("HH:mm")
                .format(ZonedDateTime.ofInstant(instant, club.zoneId()));
    }
}
