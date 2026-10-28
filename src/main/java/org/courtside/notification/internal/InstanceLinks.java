package org.courtside.notification.internal;

import org.courtside.notification.InstanceOrigin;
import org.courtside.notification.MessageKind;
import org.springframework.beans.factory.annotation.Autowired;
import org.courtside.shared.InstanceAddress;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.Optional;

@Component
class InstanceLinks implements InstanceOrigin {

    static final String PLACEHOLDER = "instanceLink";

    private final String origin;

    @Autowired
    InstanceLinks(InstanceAddress address) {
        this.origin = address.origin().map(URI::toString).orElse("");
    }

    InstanceLinks(String configured) {
        this(new InstanceAddress(configured));
    }

    @Override
    public Optional<String> origin() {
        return origin.isEmpty() ? Optional.empty() : Optional.of(origin);
    }

    String of(QueuedMessage message) {
        String target = switch (message.kind()) {
            case ACCOUNT_WELCOME -> "/";
            case ACCOUNT_SECURITY_CHANGED, ACCOUNT_FACTOR_GUESSING_BLOCKED -> "/account#security";
            case BOOKING_CONFIRMED, BOOKING_PLAYER_RECORDED, BOOKING_PLAYER_WITHDREW, BOOKING_DISPLACED,
                 BOOKING_REMINDER, BOOKING_PARTNER_FOUND, BOOKING_PLACE_TAKEN ->
                    "/my-bookings#booking-" + message.booking();
            case BOOKING_CANCELLED, BOOKING_CANCELLED_BY_CLUB, BOOKING_RELEASED, BOOKING_SERIES_CREATED,
                 BOOKING_SERIES_CANCELLED_BY_CLUB, BOOKING_SERIES_MOVED_BY_CLUB -> "/my-bookings";
            case WAITLIST_OFFER -> "/my-bookings#waitlist-" + message.waitlistEntry();
            case CREDENTIALS_NEW_ACCOUNT, CREDENTIALS_PASSWORD_RESET, ACCOUNT_USERNAME_REMINDER,
                 ACCOUNT_PASSWORD_RESET_CODE, ACCOUNT_MFA_RECOVERY_CODE ->
                    throw new IllegalStateException(message.kind() + " is a credential message and carries no link");
        };
        return origin.isEmpty() ? "" : origin + target;
    }

    // A credential message names the instance only where a club's own wording puts it.
    String root() {
        return origin.isEmpty() ? "" : origin + "/";
    }

}
