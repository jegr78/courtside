package org.courtside.notification.internal;

import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

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
        if (!accepts(value)) {
            problems.add(variable + " is not one mail address with a host (\"" + value + "\")");
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

    // A display form names a club and still carries one address, which both a mail client and the
    // relay accept. A group like "board: a@example.org;" parses and names no host at all.
    private static final Pattern ONE_ADDRESS_NAMING_A_HOST =
            Pattern.compile("[^\\s:;,<>]+@[^\\s:;,<>]+");

    static boolean accepts(String value) {
        return addressIn(value) != null;
    }

    // The domain comes from the address inside the value rather than from whatever follows its
    // first @, which can sit inside a quoted local part.
    static String senderDomain(String configured) {
        String address = addressIn(configured);
        if (address == null) {
            throw new IllegalStateException("COURTSIDE_MAIL_FROM does not name one address with a"
                    + " host, which startup verification refuses: " + configured);
        }
        return address.substring(address.lastIndexOf('@') + 1);
    }

    private static String addressIn(String value) {
        try {
            InternetAddress parsed = new InternetAddress(value, true);
            parsed.validate();
            String address = parsed.getAddress();
            return address != null && ONE_ADDRESS_NAMING_A_HOST.matcher(address).matches()
                    ? address : null;
        } catch (AddressException malformed) {
            return null;
        }
    }

    static boolean isSet(String value) {
        return value != null && !value.isBlank();
    }
}
