package org.courtside.credit;

public enum CreditEntryKind {
    CREDIT,
    PAYOUT,
    BOOKING_DEBIT,
    BOOKING_REFUND;

    public boolean forBooking() {
        return this == BOOKING_DEBIT || this == BOOKING_REFUND;
    }
}
