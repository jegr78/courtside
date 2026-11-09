package org.courtside.payment.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.booking.PendingPayments;
import org.courtside.payment.internal.PayPalCheckout.Outcome;
import org.courtside.payment.internal.PayPalOrders.Status;
import org.courtside.payment.internal.PayPalOrders.StoredOrder;
import org.courtside.payment.internal.PayPalRefunds.RefundStatus;
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

/** Settles open PayPal orders and pending refunds the request never settled and ends holds past their deadline. */
@Slf4j
@Component
@Profile("!journey")
public class PayPalReconciliation {

    static final int PAGE_SIZE = 50;
    private static final int OUTAGE_AFTER = 3;
    private static final Duration CAPTURE_WATCH = Duration.ofHours(72);

    private final PayPalOrders orders;
    private final PayPalCheckout checkout;
    private final PendingPayments pendingPayments;
    private final PayPalRefunds refunds;
    private final PayPalRefundStore refundStore;
    private final Clock clock;
    private final Duration reconcileAfter;
    private final Duration unresolvedReleaseAfter;

    PayPalReconciliation(PayPalOrders orders, PayPalCheckout checkout, PendingPayments pendingPayments,
                         PayPalRefunds refunds, PayPalRefundStore refundStore, Clock clock,
                         @Value("${courtside.payment.paypal.reconcile-after}") Duration reconcileAfter,
                         @Value("${courtside.payment.paypal.unresolved-release-after}")
                         Duration unresolvedReleaseAfter) {
        this.orders = orders;
        this.checkout = checkout;
        this.pendingPayments = pendingPayments;
        this.refunds = refunds;
        this.refundStore = refundStore;
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
                guarded(bookingId.toString(), () -> pendingPayments.release(bookingId), () -> { });
            }
        }
        Unreachable unreachable = new Unreachable();
        for (String orderId : due) {
            if (unreachable.outage()) break;
            guarded(orderId, () -> {
                PayPalCheckout.Reconciled reconciled = checkout.reconcile(orderId, unresolvedReleaseAfter);
                unreachable.count(reconciled.payPalUnreachable());
                if (reconciled.outcome() == Outcome.PROCESSING) orders.checked(orderId, Status.CREATED);
            }, () -> orders.checked(orderId, Status.CREATED));
        }
        if (!unreachable.outage()) {
            for (String orderId : orders.voidedAfterCaptureAttempt(now.minus(CAPTURE_WATCH),
                    now.minus(reconcileAfter), PAGE_SIZE)) {
                if (unreachable.outage()) break;
                guarded(orderId, () -> {
                    unreachable.count(!checkout.recheckVoided(orderId));
                    orders.checked(orderId, Status.VOIDED);
                }, () -> orders.checked(orderId, Status.VOIDED));
            }
        }
        if (!unreachable.outage()) {
            for (UUID refundId : refundStore.pendingSince(now.minus(reconcileAfter), PAGE_SIZE)) {
                if (unreachable.outage()) break;
                guarded("refund " + refundId, () -> {
                    PayPalRefunds.Resolution resolution = refunds.resolve(refundId);
                    unreachable.count(resolution.payPalUnreachable());
                    if (resolution.refund().status() == RefundStatus.PENDING) refundStore.checked(refundId);
                }, () -> refundStore.checked(refundId));
            }
        }
        if (unreachable.outage()) {
            log.warn("PayPal did not answer {} reads in a row; the remaining orders and refunds wait for the next"
                    + " run", OUTAGE_AFTER);
        }
    }

    private static void guarded(String subject, Runnable step, Runnable afterFailure) {
        try {
            step.run();
        } catch (RuntimeException failed) {
            log.error("PayPal reconciliation failed for {} and retries on the next run", subject, failed);
            try {
                afterFailure.run();
            } catch (RuntimeException alsoFailed) {
                log.error("PayPal reconciliation could not move {} back in the queue", subject, alsoFailed);
            }
        }
    }

    private static final class Unreachable {

        private int inARow;

        void count(boolean unreachable) {
            inARow = unreachable ? inARow + 1 : 0;
        }

        boolean outage() {
            return inARow >= OUTAGE_AFTER;
        }
    }
}
