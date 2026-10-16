package org.courtside.notification.internal;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

// The values a preview fills in, worded like the real ones so a board sees its sentence as a member will.
final class MessageTemplateSamples {

    private static final LocalDate DAY = LocalDate.of(2026, 5, 16);

    private MessageTemplateSamples() {
    }

    static Map<String, String> of(String language, String clubName) {
        Locale locale = Locale.forLanguageTag(language);
        boolean german = "de".equals(language);
        Map<String, String> values = new HashMap<>();
        values.put("clubName", clubName);
        values.put("firstName", "Jane");
        values.put("username", "jane.doe");
        values.put("credential", "K7m2-pX9q");
        values.put("resetCode", "4826-1937");
        values.put("player", "John Roe");
        values.put("day", DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale).format(DAY));
        values.put("untilDay", DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale).format(DAY));
        values.put("first", DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale).format(DAY));
        values.put("last", DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)
                .format(DAY.plusWeeks(9)));
        values.put("expiresOn", DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)
                .format(DAY.plusDays(7)));
        values.put("expiresAt", DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)
                .format(DAY) + " 18:30");
        values.put("from", "18:00");
        values.put("to", "19:00");
        values.put("until", "17:30");
        values.put("previousFrom", "17:00");
        values.put("previousTo", "18:00");
        values.put("count", "10");
        values.put("courts", "1");
        values.put("previousCourts", "2");
        values.put("weekdays", german ? "Samstag" : "Saturday");
        values.put("card", german ? "Mitgliederbuchung" : "Member booking");
        values.put("closure", MailTemplates.shipped("booking.displaced.court", locale));
        values.put("reason", MailTemplates.shipped("booking.cancellationReason.WEATHER", locale));
        values.put(InstanceLinks.PLACEHOLDER, "https://courts.example.org/my-bookings");
        return values;
    }
}
