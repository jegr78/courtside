package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
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

    static final String ACCESS_CODES = "accessCodes";

    private final ClubIdentity club;
    private final MailTemplates templates;

    Map<String, String> of(BookingAnnouncement booking, Locale locale) {
        return Map.of(
                "clubName", club.clubName(),
                "day", day(booking.startsAt(), locale),
                "from", time(booking.startsAt()),
                "to", time(booking.endsAt()),
                "courts", courts(booking, locale),
                "card", booking.cardLabel(),
                ACCESS_CODES, "");
    }

    // A message is written after it was queued, so the codes go only to who is in the booking at that moment.
    Map<String, String> of(BookingAnnouncement booking, UserAccount recipient, Locale locale) {
        Map<String, String> values = new HashMap<>(of(booking, locale));
        if (holds(booking, recipient)) {
            values.put(ACCESS_CODES, accessCodes(booking.access(), locale));
        }
        return values;
    }

    static boolean holds(BookingAnnouncement booking, UserAccount recipient) {
        return recipient.getId().equals(booking.bookedByAccountId())
                || recipient.getPerson() != null && booking.playerPersonIds().contains(recipient.getPerson().getId());
    }

    // Time, courts and card come from the first occurrence given, which a date moved on its own may not share.
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

    Map<String, String> previous(Instant startsAt, Instant endsAt, List<BookingAnnouncement.AnnouncedCourt> courts,
                                 Locale locale) {
        return Map.of("previousFrom", time(startsAt), "previousTo", time(endsAt),
                "previousCourts", courtNames(courts, locale));
    }

    Map<String, String> deadline(Instant at, Locale locale) {
        return Map.of("untilDay", day(at, locale), "until", time(at));
    }

    String reason(Optional<CancellationReason> reason, Locale locale) {
        return templates.render("booking.cancellationReason." + reason.map(Enum::name).orElse("none"),
                locale, Map.of());
    }

    // Empty without a grant, and an empty block takes its line with it, so such a mail reads as it always did.
    private String accessCodes(BookingAnnouncement.AnnouncedAccess access, Locale locale) {
        if (access == null) {
            return "";
        }
        String heading = templates.render("booking.access.heading", locale,
                Map.of("validFrom", time(access.validFrom()), "validUntil", time(access.validUntil())));
        return access.codes().stream()
                .map(code -> templates.render("booking.access.code", locale,
                        Map.of("accessPoint", code.accessPointName(), "code", code.code())))
                .collect(Collectors.joining("\n", heading + "\n", ""));
    }

    private String courts(BookingAnnouncement booking, Locale locale) {
        return courtNames(booking.courts(), locale);
    }

    private String courtNames(List<BookingAnnouncement.AnnouncedCourt> courts, Locale locale) {
        return courts.stream()
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
