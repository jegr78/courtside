package org.courtside.payment.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.booking.PendingPayments;
import org.courtside.payment.internal.PayPalCheckout.Outcome;
import org.courtside.payment.internal.PayPalOrders.Status;
import org.courtside.payment.internal.PayPalOrders.StoredOrder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** Settles open PayPal orders the return never settled and ends holds whose deadline has passed. */
@Slf4j
@Component
@Profile("!journey")
public class PayPalReconciliation {

    static final int PAGE_SIZE = 50;
    private static final Duration CAPTURE_WATCH = Duration.ofHours(72);

    private final PayPalOrders orders;
    private final PayPalCheckout checkout;
    private final PendingPayments pendingPayments;
    private final Clock clock;
    private final Duration reconcileAfter;
    private final Duration unresolvedReleaseAfter;

    PayPalReconciliation(PayPalOrders orders, PayPalCheckout checkout, PendingPayments pendingPayments, Clock clock,
                         @Value("${courtside.payment.paypal.reconcile-after}") Duration reconcileAfter,
                         @Value("${courtside.payment.paypal.unresolved-release-after}")
                         Duration unresolvedReleaseAfter) {
        this.orders = orders;
        this.checkout = checkout;
        this.pendingPayments = pendingPayments;
        this.clock = clock;
        this.reconcileAfter = reconcileAfter;
        this.unresolvedReleaseAfter = unresolvedReleaseAfter;
    }

    @Scheduled(initialDelay = 30, timeUnit = TimeUnit.SECONDS,
            fixedDelayString = "${courtside.payment.paypal.reconcile-interval}")
    public void run() {
        Instant now = clock.instant();
        Set<String> due = new LinkedHashSet<>(orders.openSince(now.minus(reconcileAfter), PAGE_SIZE));
        for (UUID bookingId : pendingPayments.expiredAt(now)) {
            Optional<StoredOrder> order = orders.ofBooking(bookingId);
            if (order.isPresent() && order.get().status() == Status.CREATED) {
                due.add(order.get().orderId());
            } else if (order.isEmpty() || order.get().status() == Status.REJECTED
                    || order.get().status() == Status.VOIDED) {
                guarded(bookingId.toString(), () -> pendingPayments.release(bookingId));
            }
        }
        for (String orderId : due) {
            guarded(orderId, () -> {
                if (checkout.reconcile(orderId, unresolvedReleaseAfter).outcome() == Outcome.PROCESSING) {
                    orders.checked(orderId, Status.CREATED);
                }
            });
        }
        for (String orderId : orders.voidedAfterCaptureAttempt(now.minus(CAPTURE_WATCH), now.minus(reconcileAfter),
                PAGE_SIZE)) {
            guarded(orderId, () -> {
                checkout.recheckVoided(orderId);
                orders.checked(orderId, Status.VOIDED);
            });
        }
    }

    private static void guarded(String subject, Runnable step) {
        try {
            step.run();
        } catch (RuntimeException failed) {
            log.error("PayPal reconciliation failed for {} and retries on the next run", subject, failed);
        }
    }
}
