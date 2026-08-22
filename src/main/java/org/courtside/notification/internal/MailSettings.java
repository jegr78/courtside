package org.courtside.notification.internal;

import jakarta.mail.internet.InternetAddress;

import java.util.ArrayList;
import java.util.List;

// A club board sets environment variables in .env, so a startup failure names those and not the
// Spring property they happen to bind to.
final class MailSettings {

    private MailSettings() {
    }

    static void verify(MailProperties properties) {
        List<String> problems = new ArrayList<>();
        requirePresent(problems, "COURTSIDE_MAIL_RELAY_HOST", properties.host());
        requireAddress(problems, "COURTSIDE_MAIL_FROM", properties.from());
        requireAddress(problems, "COURTSIDE_MAIL_REPLY_TO", properties.replyTo());
        requirePaired(problems, properties);
        if (!problems.isEmpty()) {
            throw new IllegalStateException("Courtside cannot send mail and will not start. In .env: "
                    + String.join("; ", problems));
        }
    }

    private static void requirePresent(List<String> problems, String variable, String value) {
        if (!isSet(value)) {
            problems.add(variable + " is not set");
        }
    }

    private static void requireAddress(List<String> problems, String variable, String value) {
        if (!isSet(value)) {
            problems.add(variable + " is not set");
            return;
        }
        try {
            new InternetAddress(value, true).validate();
        } catch (Exception malformed) {
            problems.add(variable + " is not a mail address (\"" + value + "\")");
        }
    }

    // Either both or neither: a username without its password authenticates nowhere, and a password
    // without a username is a credential the instance never sends.
    private static void requirePaired(List<String> problems, MailProperties properties) {
        if (isSet(properties.username()) == isSet(properties.password())) {
            return;
        }
        problems.add(isSet(properties.username())
                ? "COURTSIDE_MAIL_USERNAME is set without COURTSIDE_MAIL_PASSWORD"
                : "COURTSIDE_MAIL_PASSWORD is set without COURTSIDE_MAIL_USERNAME");
    }

    static boolean isSet(String value) {
        return value != null && !value.isBlank();
    }
}
