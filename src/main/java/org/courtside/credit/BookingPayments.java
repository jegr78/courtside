package org.courtside.credit;

import java.util.Currency;
import java.util.Optional;
import java.util.UUID;

/** Pays a booking from the booker's credit and returns that payment on cancellation; both join the caller's transaction. */
public interface BookingPayments {

    BookingDebit debit(UUID accountId, UUID bookingId, int amountMinor, Currency currency);

    void refund(UUID bookingId);

    Optional<Payment> paymentOf(UUID bookingId);

    record BookingDebit(boolean covered, long balanceMinor, String currency) {
    }

    record Payment(int amountMinor, String currency, boolean refunded) {
    }
}
