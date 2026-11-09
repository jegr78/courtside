package org.courtside.credit;

import java.util.Currency;
import java.util.Optional;
import java.util.UUID;

/** Pays a booking from the booker's credit and returns that payment on cancellation; both join the caller's transaction. */
public interface BookingPayments {

    BookingDebit debit(UUID accountId, UUID bookingId, int amountMinor, Currency currency);

    void payByPayPal(UUID accountId, UUID bookingId, String orderId, int amountMinor, Currency currency);

    boolean creditLateCapture(UUID accountId, UUID bookingId, String orderId, int amountMinor, Currency currency);

    void refund(UUID bookingId);

    Optional<Payment> paymentOf(UUID bookingId);

    Optional<PayPalCredit> payPalCreditOf(String orderId);

    RefundReservation takeForPayPalRefund(UUID accountId, UUID bookingId, String orderId, int amountMinor,
                                          Currency currency);

    void restoreAfterPayPalRefund(UUID accountId, UUID bookingId, String orderId, int amountMinor, Currency currency);

    long balanceMinor(UUID accountId, Currency currency);

    record BookingDebit(boolean covered, long balanceMinor, String currency) {
    }

    enum PaymentMethod { CREDIT, PAYPAL }

    record Payment(int amountMinor, String currency, PaymentMethod method, boolean refunded) {
    }

    record PayPalCredit(UUID accountId, UUID bookingId, int amountMinor, String currency, boolean creditedBack) {
    }

    record RefundReservation(boolean taken, long balanceMinor, String currency) {
    }
}
