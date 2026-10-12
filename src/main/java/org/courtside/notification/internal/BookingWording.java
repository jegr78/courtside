package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.CancellationReason;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.time.format.TextStyle;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;
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

    // The first occurrence stands for the series' time, courts and card, which its occurrences share.
    Map<String, String> ofSeries(List<BookingAnnouncement> occurrences, Locale locale) {
        Map<String, String> values = new HashMap<>(of(occurrences.getFirst(), locale));
        values.put("weekdays", occurrences.stream()
                .map(occurrence -> ZonedDateTime.ofInstant(occurrence.startsAt(), club.zoneId()).getDayOfWeek())
                .collect(Collectors.toCollection(TreeSet::new)).stream()
                .map(weekday -> weekday.getDisplayName(TextStyle.FULL, locale))
                .collect(Collectors.joining(", ")));
        values.put("first", day(occurrences.getFirst().startsAt(), locale));
        values.put("last", day(occurrences.getLast().startsAt(), locale));
        values.put("count", String.valueOf(occurrences.size()));
        return values;
    }

    Map<String, String> previous(Instant startsAt, Instant endsAt) {
        return Map.of("previousFrom", time(startsAt), "previousTo", time(endsAt));
    }

    String reason(Optional<CancellationReason> reason, Locale locale) {
        return templates.render("booking.cancellationReason." + reason.map(Enum::name).orElse("none"),
                locale, Map.of());
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
