package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.IDN;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
class InstanceLinks {

    static final String PLACEHOLDER = "instanceLink";
    private static final Pattern AUTHORITY = Pattern.compile("(\\[[0-9A-Fa-f:.]+]|[^:@\\[\\]]+)(?::([0-9]{1,5}))?");

    private final String origin;

    InstanceLinks(@Value("${courtside.public-url:}") String configured) {
        this.origin = originOf(configured);
    }

    String of(QueuedMessage message) {
        String target = switch (message.kind()) {
            case ACCOUNT_WELCOME -> "/";
            case BOOKING_CONFIRMED, BOOKING_PLAYER_RECORDED, BOOKING_PLAYER_WITHDREW, BOOKING_DISPLACED,
                 BOOKING_REMINDER, BOOKING_PARTNER_FOUND, BOOKING_PLACE_TAKEN ->
                    "/my-bookings#booking-" + message.booking();
            case BOOKING_CANCELLED, BOOKING_CANCELLED_BY_CLUB, BOOKING_RELEASED, BOOKING_SERIES_CREATED,
                 BOOKING_SERIES_CANCELLED_BY_CLUB, BOOKING_SERIES_MOVED_BY_CLUB -> "/my-bookings";
            case WAITLIST_OFFER -> "/my-bookings#waitlist-" + message.waitlistEntry();
            case CREDENTIALS_NEW_ACCOUNT, CREDENTIALS_PASSWORD_RESET, ACCOUNT_USERNAME_REMINDER,
                 ACCOUNT_PASSWORD_RESET_CODE ->
                    throw new IllegalStateException(message.kind() + " is a credential message and carries no link");
        };
        return origin.isEmpty() ? "" : origin + target;
    }

    // A credential message names the instance only where a club's own wording puts it.
    String root() {
        return origin.isEmpty() ? "" : origin + "/";
    }

    // The value never reaches the failure, because it may hold credentials.
    private static String originOf(String configured) {
        if (configured == null || configured.isBlank()) {
            return "";
        }
        String origin = asciiOrigin(configured.strip());
        if (origin == null) {
            throw new IllegalStateException("COURTSIDE_PUBLIC_URL must be the absolute https address of this"
                    + " instance without path, query or credentials, such as https://courts.example.org;"
                    + " Courtside will not start");
        }
        return origin;
    }

    private static String asciiOrigin(String configured) {
        try {
            URI address = new URI(configured);
            Matcher authority = address.getRawAuthority() == null ? null
                    : AUTHORITY.matcher(address.getRawAuthority());
            if (!"https".equalsIgnoreCase(address.getScheme()) || authority == null || !authority.matches()
                    || !(address.getRawPath().isEmpty() || address.getRawPath().equals("/"))
                    || address.getRawQuery() != null || address.getRawFragment() != null) {
                return null;
            }
            int port = authority.group(2) == null ? -1 : Integer.parseInt(authority.group(2));
            if (port == 0 || port > 65_535) {
                return null;
            }
            String host = authority.group(1).startsWith("[") ? authority.group(1)
                    : IDN.toASCII(authority.group(1), IDN.USE_STD3_ASCII_RULES);
            URI origin = new URI("https", null, host, port, null, null, null);
            return origin.getHost() == null ? null : origin.toString();
        } catch (URISyntaxException | IllegalArgumentException malformed) {
            return null;
        }
    }
}
