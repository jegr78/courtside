package org.courtside.credit;

public enum CreditEntryKind {
    CREDIT,
    PAYOUT,
    BOOKING_DEBIT,
    BOOKING_REFUND,
    PAYPAL_PAYMENT,
    PAYPAL_LATE_CAPTURE;

    public boolean forBooking() {
        return this == BOOKING_DEBIT || this == BOOKING_REFUND || this == PAYPAL_PAYMENT
                || this == PAYPAL_LATE_CAPTURE;
    }
}
