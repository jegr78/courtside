package org.courtside.notification.internal;

import java.util.Locale;

final class MessageLanguage {

    private MessageLanguage() {
    }

    // The account's own language decides, and the club's answers for an account that names none —
    // a message in a language its reader did not choose is the one outcome to avoid.
    static Locale of(String accountTag, String clubDefault) {
        return Locale.forLanguageTag(
                accountTag == null || accountTag.isBlank() ? clubDefault : accountTag);
    }
}
