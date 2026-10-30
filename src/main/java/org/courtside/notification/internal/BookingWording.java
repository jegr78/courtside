package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.identity.UserAccount;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.CancellationReason;
import org.courtside.shared.IssuedAccessCodes;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class BookingWording {

    static final String ACCESS_CODES = "accessCodes";
    static final String CODE_FOLLOWS = "booking.access.follows";
    static final String CODE_MISSING = "booking.access.missing";

    private final ClubIdentity club;
    private final MailTemplates templates;
    private final IssuedAccessCodes issuedCodes;

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

    record AccessLines(String text, boolean codeFollows) {
    }

    // A message is written after it was queued, so the codes go only to who is in the booking at that moment,
    // and the booking's own code is only looked up for them.
    AccessLines access(UUID bookingId, BookingAnnouncement booking, UserAccount recipient, Locale locale,
                       String pendingKey, boolean withStaticCodes) {
        if (!holds(booking, recipient)) {
            return new AccessLines("", false);
        }
        BookingAnnouncement.AnnouncedAccess fixed = withStaticCodes ? booking.access() : null;
        BookingAnnouncement.DynamicAccess dynamic = booking.dynamicAccess();
        List<String> lines = new ArrayList<>();
        if (fixed != null) {
            fixed.codes().forEach(code -> lines.add(codeLine(code.accessPointName(), code.code(), locale)));
        }
        String issued = dynamic == null ? null : issuedCodes.codeOf(bookingId).orElse(null);
        if (issued != null) {
            dynamic.accessPointNames().forEach(name -> lines.add(codeLine(name, issued, locale)));
        }
        List<String> block = new ArrayList<>();
        if (!lines.isEmpty()) {
            Instant validFrom = fixed != null ? fixed.validFrom() : dynamic.validFrom();
            Instant validUntil = fixed != null ? fixed.validUntil() : dynamic.validUntil();
            block.add(templates.render("booking.access.heading", locale,
                    Map.of("validFrom", time(validFrom), "validUntil", time(validUntil))));
            block.addAll(lines);
        }
        boolean pending = dynamic != null && issued == null;
        if (pending && pendingKey != null) {
            block.add(templates.render(pendingKey, locale, Map.of()));
        }
        return new AccessLines(String.join("\n", block), pending);
    }

    private String codeLine(String accessPoint, String code, Locale locale) {
        return templates.render("booking.access.code", locale,
                Map.of("accessPoint", accessPoint, "accessCode", code));
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
