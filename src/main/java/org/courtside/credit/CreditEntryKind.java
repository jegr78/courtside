package org.courtside.credit;

public enum CreditEntryKind {
    CREDIT,
    PAYOUT,
    BOOKING_DEBIT,
    BOOKING_REFUND,
    PAYPAL_PAYMENT,
    PAYPAL_LATE_CAPTURE,
    PAYPAL_REFUND,
    PAYPAL_REFUND_REVERSED;

    public boolean forBooking() {
        return this != CREDIT && this != PAYOUT;
    }
}
