package org.courtside.payment.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.credit.BookingPayments;
import org.courtside.credit.BookingPayments.PayPalCredit;
import org.courtside.credit.BookingPayments.RefundReservation;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.payment.PaymentEvent;
import org.courtside.payment.internal.PayPalOrders.Status;
import org.courtside.payment.internal.PayPalOrders.StoredOrder;
import org.courtside.payment.internal.PayPalRefundStore.StoredRefund;
import org.jspecify.annotations.Nullable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Comparator;
import java.util.Currency;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Returns a PayPal payment through PayPal and takes its credit back; PayPal is called outside any transaction. */
@Slf4j
@Service
@RequiredArgsConstructor
public class PayPalRefunds {

    static final String NOT_REFUNDABLE = "payment.paypal.refund.notRefundable";
    static final String NOT_CREDITED = "payment.paypal.refund.notCredited";
    static final String ALREADY_REFUNDED = "payment.paypal.refund.alreadyRefunded";
    static final String CREDIT_SPENT = "payment.paypal.refund.creditSpent";
    static final String UNAVAILABLE = "payment.paypal.refund.unavailable";
    private static final int MAX_OPTIONS = 1000;
    private static final int MAX_REASON = 200;

    private final PayPalClient client;
    private final PayPalOrders orders;
    private final PayPalRefundStore refunds;
    private final PayPalCredentials credentials;
    private final BookingPayments bookingPayments;
    private final UserAccountRepository accounts;
    private final RecentAuthentication recentAuthentication;
    private final CurrentUser currentUser;
    private final TransactionTemplate transactions;
    private final ApplicationEventPublisher events;

    /** Takes the order's credit back, asks PayPal to refund its capture in full and records the answer. */
    public RefundView refund(String orderId) {
        recentAuthentication.requireRecent();
        PayPalCheckout.requireNoTransaction();
        if (orderId == null || orderId.isBlank()) throw PayPalRefundException.notRefundable();
        UUID actor = currentUser.accountId().orElseThrow(() -> new IllegalStateException(
                "A PayPal refund is requested by a signed-in account"));
        Reserved reserved = transactions.execute(status -> reserve(orderId, actor));
        return ask(reserved.refund(), reserved.order(), reserved.credentials()).refund();
    }

    /** Repeats the refund request of a pending refund, or reads the refund PayPal named, and records the answer. */
    public Resolution resolve(UUID refundId) {
        PayPalCheckout.requireNoTransaction();
        StoredRefund refund = refunds.find(refundId).orElseThrow(() -> new IllegalStateException(
                "PayPal refund " + refundId + " does not exist"));
        if (refund.status() != RefundStatus.PENDING) return answered(view(refund));
        StoredOrder order = lockless(refund.orderId());
        Optional<PayPalClient.Credentials> readable = credentials.stored(order.environment());
        if (readable.isEmpty()) {
            log.warn("PayPal refund {} of order {} cannot be resolved: no stored {} credentials", refund.id(),
                    refund.orderId(), order.environment());
            return answered(view(refund));
        }
        if (refund.refundId() == null) return askAgain(refund, order, readable.get());
        try {
            return answered(record(refund, client.getRefund(readable.get(), refund.refundId())));
        } catch (PayPalUnavailableException down) {
            log.warn("PayPal refund {} of order {} could not be read: {}", refund.id(), refund.orderId(),
                    down.getMessage());
            return unreachable(refund);
        } catch (PayPalRefusedException refused) {
            log.warn("PayPal refund {} of order {} could not be read: {}", refund.id(), refund.orderId(),
                    refused.reason());
            return answered(view(refund));
        }
    }

    /** Whether and why each captured PayPal payment of the account can be returned, newest first. */
    public List<RefundOption> ofAccount(UUID accountId) {
        if (accountId == null) throw new IllegalStateException("PayPal refunds are listed for an account");
        Optional<PayPalClient.Credentials> active = credentials.active();
        Map<Currency, Long> balances = new HashMap<>();
        return orders.capturedOf(accountId, MAX_OPTIONS).stream()
                .map(order -> option(order, active, balances)).toList();
    }

    private RefundOption option(StoredOrder order, Optional<PayPalClient.Credentials> active,
                                Map<Currency, Long> balances) {
        Optional<StoredRefund> refund = refunds.ofOrder(order.orderId());
        if (refund.isPresent()) {
            return new RefundOption(order.orderId(), false, refund.get().status(), refund.get().failureReason(),
                    ALREADY_REFUNDED);
        }
        Optional<PayPalCredit> credit = creditOf(order);
        if (credit.isEmpty()) return blocked(order, neverCredited(order) ? NOT_CREDITED : NOT_REFUNDABLE);
        if (active.filter(credentials -> credentials.environment() == order.environment()).isEmpty()) {
            return blocked(order, UNAVAILABLE);
        }
        long balance = balances.computeIfAbsent(order.currency(),
                currency -> bookingPayments.balanceMinor(order.accountId(), currency));
        if (balance < credit.get().amountMinor()) {
            return blocked(order, CREDIT_SPENT);
        }
        return new RefundOption(order.orderId(), true, null, null, null);
    }

    private static RefundOption blocked(StoredOrder order, String code) {
        return new RefundOption(order.orderId(), false, null, null, code);
    }

    private Reserved reserve(String orderId, UUID actor) {
        StoredOrder order = orders.lock(orderId).filter(PayPalRefunds::captured)
                .orElseThrow(PayPalRefundException::notRefundable);
        PayPalCredit credit = creditOf(order).orElseThrow(() -> neverCredited(order)
                ? PayPalRefundException.notCredited() : PayPalRefundException.notRefundable());
        if (refunds.ofOrder(orderId).isPresent()) throw PayPalRefundException.alreadyRefunded();
        PayPalClient.Credentials active = credentials.active(order.environment()).orElseThrow(() -> {
            log.info("PayPal order {} is not refunded: no active {} credentials", orderId, order.environment());
            return new PayPalRefundUnavailableException();
        });
        captureOf(order);
        RefundReservation taken = bookingPayments.takeForPayPalRefund(credit.accountId(), credit.bookingId(),
                orderId, credit.amountMinor(), order.currency());
        if (!taken.taken()) {
            throw PayPalRefundException.creditSpent(credit.amountMinor(), taken.balanceMinor(), taken.currency());
        }
        StoredRefund refund = new StoredRefund(UUID.randomUUID(), orderId, credit.accountId(), credit.amountMinor(),
                order.currency(), RefundStatus.PENDING, null, null);
        refunds.insert(refund, actor);
        events.publishEvent(new PaymentEvent.PayPalRefundRequested(order.bookingId(), orderId, order.environment(),
                refund.amountMinor(), refund.currency().getCurrencyCode()));
        log.info("PayPal refund {} of order {} took its credit back and goes to PayPal", refund.id(), orderId);
        return new Reserved(refund, order, active);
    }

    /** A late capture Courtside kept no credit for, which only the club's PayPal account can return. */
    private boolean neverCredited(StoredOrder order) {
        return order.status() == Status.LATE_CAPTURED && bookingPayments.payPalCreditOf(order.orderId()).isEmpty();
    }

    private Optional<PayPalCredit> creditOf(StoredOrder order) {
        return bookingPayments.payPalCreditOf(order.orderId()).filter(PayPalCredit::creditedBack)
                .filter(credit -> credit.accountId().equals(order.accountId())
                        && credit.bookingId().equals(order.bookingId())
                        && credit.currency().equals(order.currency().getCurrencyCode()));
    }

    private Resolution ask(StoredRefund refund, StoredOrder order, PayPalClient.Credentials readable) {
        PayPalCheckout.requireNoTransaction();
        PayPalClient.Refund answer;
        try {
            answer = client.refundCapture(readable, captureOf(order), refund.id());
        } catch (PayPalCaptureFullyRefundedException fullyRefunded) {
            return refundedElsewhere(refund, readable);
        } catch (PayPalRefundRefusedException refused) {
            log.warn("PayPal refused refund {} of order {}: {}", refund.id(), refund.orderId(), refused.reason());
            return refusedUnlessListed(refund, readable, refused.reason());
        } catch (PayPalRefusedException unclear) {
            log.warn("PayPal refund {} of order {} was not answered by the refund itself and stays pending: {}",
                    refund.id(), refund.orderId(), unclear.reason());
            return answered(view(refund));
        } catch (PayPalUnavailableException unknown) {
            log.warn("PayPal refund {} of order {} has no known outcome yet: {}", refund.id(), refund.orderId(),
                    unknown.getMessage());
            return unreachable(refund);
        }
        return answered(record(refund, answer));
    }

    private Resolution askAgain(StoredRefund refund, StoredOrder order, PayPalClient.Credentials readable) {
        PayPalCheckout.requireNoTransaction();
        Optional<PayPalClient.ListedRefund> listed;
        try {
            listed = listedRefundOf(refund, readable);
        } catch (PayPalUnavailableException down) {
            log.warn("PayPal order {} of refund {} could not be read before a retry: {}", refund.orderId(),
                    refund.id(), down.getMessage());
            return unreachable(refund);
        } catch (PayPalRefusedException refused) {
            log.warn("PayPal order {} of refund {} could not be read before a retry: {}", refund.orderId(),
                    refund.id(), refused.reason());
            return answered(view(refund));
        }
        return listed.map(found -> answered(follow(refund, found))).orElseGet(() -> ask(refund, order, readable));
    }

    private Resolution refundedElsewhere(StoredRefund refund, PayPalClient.Credentials readable) {
        PayPalCheckout.requireNoTransaction();
        Optional<PayPalClient.ListedRefund> listed;
        try {
            listed = listedRefundOf(refund, readable);
        } catch (PayPalUnavailableException down) {
            log.warn("PayPal order {} of refund {} could not be read: {}", refund.orderId(), refund.id(),
                    down.getMessage());
            return unreachable(refund);
        } catch (PayPalRefusedException refused) {
            log.warn("PayPal order {} of refund {} could not be read: {}", refund.orderId(), refund.id(),
                    refused.reason());
            return answered(view(refund));
        }
        if (listed.isPresent()) return answered(follow(refund, listed.get()));
        log.warn("PayPal reports the capture of order {} as refunded but lists no refund of its full amount; refund {}"
                + " stays pending", refund.orderId(), refund.id());
        return answered(view(refund));
    }

    private Resolution refusedUnlessListed(StoredRefund refund, PayPalClient.Credentials readable, String reason) {
        PayPalCheckout.requireNoTransaction();
        Optional<PayPalClient.ListedRefund> listed;
        try {
            listed = listedRefundOf(refund, readable);
        } catch (PayPalUnavailableException down) {
            log.warn("PayPal order {} of refused refund {} could not be read: {}", refund.orderId(), refund.id(),
                    down.getMessage());
            return unreachable(refund);
        } catch (PayPalRefusedException unread) {
            log.warn("PayPal order {} of refused refund {} could not be read: {}", refund.orderId(), refund.id(),
                    unread.reason());
            return answered(view(refund));
        }
        return answered(listed.map(found -> follow(refund, found)).orElseGet(() -> failed(refund, null, reason)));
    }

    /** The full-amount refund PayPal lists on the order that has not failed, a completed one first. */
    private Optional<PayPalClient.ListedRefund> listedRefundOf(StoredRefund refund,
                                                               PayPalClient.Credentials readable) {
        return client.getOrder(readable, refund.orderId()).refunds().stream()
                .filter(listed -> listed.amountMinor() == refund.amountMinor()
                        && listed.currency().equals(refund.currency().getCurrencyCode()))
                .filter(listed -> !listed.status().equals("FAILED") && !listed.status().equals("CANCELLED"))
                .min(Comparator.comparing(listed -> !listed.status().equals("COMPLETED")));
    }

    private RefundView follow(StoredRefund refund, PayPalClient.ListedRefund listed) {
        return listed.status().equals("COMPLETED") ? completed(refund, listed.id()) : pending(refund, listed.id());
    }

    private RefundView record(StoredRefund refund, PayPalClient.Refund answer) {
        return switch (answer.status()) {
            case "COMPLETED" -> answer.mayCover(refund.amountMinor(), refund.currency().getCurrencyCode())
                    ? completed(refund, answer.id()) : partial(refund, answer);
            case "FAILED", "CANCELLED" -> failed(refund, answer.id(), "PayPal reports the refund as "
                    + answer.status() + (answer.reason() == null ? "" : ": " + answer.reason()));
            default -> pending(refund, answer.id());
        };
    }

    private RefundView completed(StoredRefund refund, String refundId) {
        return transactions.execute(status -> {
            StoredOrder locked = lock(refund.orderId());
            StoredRefund current = current(refund);
            if (current.status() != RefundStatus.PENDING) return view(current);
            refunds.completed(current.id(), refundId);
            events.publishEvent(new PaymentEvent.PayPalRefunded(locked.bookingId(), current.accountId(),
                    current.orderId(), locked.environment(), refundId, current.amountMinor(),
                    current.currency().getCurrencyCode(), anonymised(current.accountId())));
            log.info("PayPal completed refund {} of order {}", current.id(), current.orderId());
            return new RefundView(current.orderId(), RefundStatus.COMPLETED, null);
        });
    }

    private RefundView failed(StoredRefund refund, @Nullable String refundId, String payPalReason) {
        String reason = bounded(payPalReason);
        return transactions.execute(status -> {
            StoredOrder locked = lock(refund.orderId());
            StoredRefund current = current(refund);
            if (current.status() != RefundStatus.PENDING) return view(current);
            refunds.failed(current.id(), refundId, reason);
            bookingPayments.restoreAfterPayPalRefund(current.accountId(), locked.bookingId(), current.orderId(),
                    current.amountMinor(), current.currency());
            events.publishEvent(new PaymentEvent.PayPalRefundFailed(locked.bookingId(), current.orderId(),
                    locked.environment(), current.amountMinor(), current.currency().getCurrencyCode(), reason));
            log.warn("PayPal refund {} of order {} failed and its credit is restored", current.id(), current.orderId());
            return new RefundView(current.orderId(), RefundStatus.FAILED, reason);
        });
    }

    private RefundView partial(StoredRefund refund, PayPalClient.Refund answer) {
        log.warn("PayPal completed refund {} of order {} for {} {} instead of {} {}; it stays pending", answer.id(),
                refund.orderId(), answer.amountMinor(), answer.currency(), refund.amountMinor(),
                refund.currency().getCurrencyCode());
        return pending(refund, answer.id());
    }

    private RefundView pending(StoredRefund refund, String refundId) {
        return transactions.execute(status -> {
            lock(refund.orderId());
            StoredRefund current = current(refund);
            if (current.status() != RefundStatus.PENDING) return view(current);
            refunds.pending(current.id(), refundId);
            log.info("PayPal holds refund {} of order {} as pending", current.id(), current.orderId());
            return view(current);
        });
    }

    private Resolution unreachable(StoredRefund refund) {
        return new Resolution(view(refunds.find(refund.id()).orElse(refund)), true);
    }

    private StoredRefund current(StoredRefund refund) {
        return refunds.find(refund.id()).orElseThrow(() -> new IllegalStateException(
                "PayPal refund " + refund.id() + " vanished"));
    }

    private StoredOrder lock(String orderId) {
        return orders.lock(orderId).orElseThrow(() -> new IllegalStateException(
                "PayPal order " + orderId + " vanished"));
    }

    private StoredOrder lockless(String orderId) {
        return orders.find(orderId).orElseThrow(() -> new IllegalStateException(
                "PayPal order " + orderId + " vanished"));
    }

    private boolean anonymised(UUID accountId) {
        return accounts.findById(accountId).map(UserAccount::isAnonymised).orElse(true);
    }

    private static String captureOf(StoredOrder order) {
        if (order.captureId() == null) {
            throw new IllegalStateException("Captured PayPal order " + order.orderId() + " has no capture id");
        }
        return order.captureId();
    }

    private static boolean captured(StoredOrder order) {
        return order.status() == Status.CAPTURED || order.status() == Status.LATE_CAPTURED;
    }

    private static String bounded(String reason) {
        String stripped = reason == null ? "" : reason.strip();
        if (stripped.isEmpty()) return "PayPal refused the refund";
        if (stripped.length() <= MAX_REASON) return stripped;
        int end = Character.isHighSurrogate(stripped.charAt(MAX_REASON - 1)) ? MAX_REASON - 1 : MAX_REASON;
        return stripped.substring(0, end).strip();
    }

    private static Resolution answered(RefundView view) {
        return new Resolution(view, false);
    }

    private static RefundView view(StoredRefund refund) {
        return new RefundView(refund.orderId(), refund.status(), refund.failureReason());
    }

    public enum RefundStatus { PENDING, COMPLETED, FAILED }

    public record RefundView(String orderId, RefundStatus status, @Nullable String failureReason) {
    }

    /** One payment of an account: refundable, or the code a return would be refused with and any refund's state. */
    public record RefundOption(String orderId, boolean refundable, @Nullable RefundStatus status,
                               @Nullable String failureReason, @Nullable String blockedBy) {
    }

    /** The refund after one resolution and whether PayPal failed to answer it. */
    public record Resolution(RefundView refund, boolean payPalUnreachable) {
    }

    private record Reserved(StoredRefund refund, StoredOrder order, PayPalClient.Credentials credentials) {
    }
}
