package org.courtside.booking;

import java.time.Instant;
import java.util.Currency;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PendingPayments {

    Optional<PendingBooking> pending(UUID bookingId);

    /** Confirms a pending booking inside the caller's transaction, holding its row until that commits. */
    ConfirmOutcome confirm(UUID bookingId);

    /** Ends the hold, frees the court and reports it; false when the booking is no longer pending. */
    boolean release(UUID bookingId);

    List<UUID> pendingSince(Instant before);

    List<UUID> expiredAt(Instant now);

    record PendingBooking(UUID bookingId, UUID bookedBy, int amountMinor, Currency currency, Instant expiresAt) {
    }

    enum ConfirmOutcome { CONFIRMED, ALREADY_CONFIRMED, NOT_PENDING }
}
