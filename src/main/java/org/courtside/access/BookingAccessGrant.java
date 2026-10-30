package org.courtside.access;

import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;

import java.time.Instant;

/** A booking's dynamic access as players may learn it; the code only once a door accepted it and while wanted. */
@NullMarked
public record BookingAccessGrant(GrantStatus status, @Nullable String code, @Nullable Instant validFrom,
                                 @Nullable Instant validUntil) {

    @Override
    public String toString() {
        return "BookingAccessGrant[status=" + status + ", validFrom=" + validFrom + ", validUntil=" + validUntil
                + "]";
    }
}
