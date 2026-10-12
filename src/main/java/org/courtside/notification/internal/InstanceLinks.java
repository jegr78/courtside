package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.EnumSet;
import java.util.Set;

// Credential messages never carry a link, so a genuine one gives members a rule to hold a fake against.
@Component
class InstanceLinks {

    static final String PLACEHOLDER = "instanceLink";
    static final Set<MessageKind> LINKED = EnumSet.of(MessageKind.BOOKING_CONFIRMED,
            MessageKind.BOOKING_PLAYER_RECORDED, MessageKind.BOOKING_PLAYER_WITHDREW, MessageKind.BOOKING_DISPLACED,
            MessageKind.BOOKING_REMINDER, MessageKind.BOOKING_CANCELLED, MessageKind.BOOKING_CANCELLED_BY_CLUB,
            MessageKind.BOOKING_SERIES_CREATED, MessageKind.BOOKING_SERIES_CANCELLED_BY_CLUB,
            MessageKind.BOOKING_SERIES_MOVED_BY_CLUB, MessageKind.WAITLIST_OFFER);

    private final String origin;

    InstanceLinks(@Value("${courtside.public-url:}") String configured) {
        this.origin = originOf(configured);
    }

    String of(QueuedMessage message) {
        String target = switch (message.kind()) {
            case BOOKING_CONFIRMED, BOOKING_PLAYER_RECORDED, BOOKING_PLAYER_WITHDREW, BOOKING_DISPLACED,
                 BOOKING_REMINDER -> "/my-bookings#booking-" + message.booking();
            case BOOKING_CANCELLED, BOOKING_CANCELLED_BY_CLUB, BOOKING_SERIES_CREATED,
                 BOOKING_SERIES_CANCELLED_BY_CLUB, BOOKING_SERIES_MOVED_BY_CLUB -> "/my-bookings";
            case WAITLIST_OFFER -> "/my-bookings#waitlist-" + message.waitlistEntry();
            case CREDENTIALS_NEW_ACCOUNT, CREDENTIALS_PASSWORD_RESET, ACCOUNT_USERNAME_REMINDER,
                 ACCOUNT_PASSWORD_RESET_CODE ->
                    throw new IllegalStateException(message.kind() + " is a credential message and carries no link");
        };
        return origin.isEmpty() ? "" : origin + target;
    }

    // The value never reaches the failure, because it may hold credentials.
    private static String originOf(String configured) {
        if (configured == null || configured.isBlank()) {
            return "";
        }
        URI address = parsed(configured.strip());
        if (address == null || !"https".equalsIgnoreCase(address.getScheme()) || address.getHost() == null
                || address.getRawUserInfo() != null || !(address.getRawPath().isEmpty() || address.getRawPath().equals("/"))
                || address.getRawQuery() != null || address.getRawFragment() != null) {
            throw new IllegalStateException("COURTSIDE_PUBLIC_URL must be the absolute https address of this"
                    + " instance without path, query or credentials, such as https://courts.example.org;"
                    + " Courtside will not start");
        }
        return "https://" + address.getRawAuthority();
    }

    private static URI parsed(String configured) {
        try {
            return new URI(configured);
        } catch (URISyntaxException malformed) {
            return null;
        }
    }
}
