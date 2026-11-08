package org.courtside.payment.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.booking.PendingPayments;
import org.courtside.booking.PendingPayments.ConfirmOutcome;
import org.courtside.booking.PendingPayments.PendingBooking;
import org.courtside.config.ClubCurrency;
import org.courtside.credit.BookingPayments;
import org.courtside.identity.CurrentUser;
import org.courtside.payment.PaymentEvent;
import org.courtside.payment.internal.PayPalOrders.Status;
import org.courtside.payment.internal.PayPalOrders.StoredOrder;
import org.courtside.shared.InstanceAddress;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.net.URI;
import java.util.Currency;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Creates, captures and cancels the PayPal order of a pending booking; PayPal is called outside any transaction. */
@Slf4j
@Service
@RequiredArgsConstructor
public class PayPalCheckout {

    private static final String RETURN_PATH = "/payment/paypal/return";
    private static final String CANCEL_PATH = "/payment/paypal/cancel";
    private static final Set<String> UNCAPTURED = Set.of("APPROVED", "CREATED", "PAYER_ACTION_REQUIRED", "VOIDED");

    private final PayPalClient client;
    private final PayPalOrders orders;
    private final PayPalSettingsService settings;
    private final PayPalAvailability availability;
    private final PendingPayments pendingPayments;
    private final BookingPayments bookingPayments;
    private final ClubCurrency clubCurrency;
    private final InstanceAddress instance;
    private final CurrentUser currentUser;
    private final TransactionTemplate transactions;
    private final ApplicationEventPublisher events;

    public boolean available() {
        return availability.payPalAvailable();
    }

    /** The signed-in booker's order for a pending booking, created at PayPal on the first call. */
    public CreatedOrder create(UUID bookingId) {
        requireNoTransaction();
        URI origin = instance.origin().orElseThrow(PayPalPublicUrlMissingException::new);
        UUID account = signedIn();
        PendingBooking pending = pendingPayments.pending(bookingId)
                .filter(booking -> booking.bookedBy().equals(account))
                .orElseThrow(PayPalOrderNotFoundException::new);
        Optional<StoredOrder> existing = orders.ofBooking(bookingId);
        if (existing.isPresent()) return created(existing.get());
        PayPalClient.Credentials credentials = settings.activeCredentials().orElseThrow(() -> {
            log.info("PayPal payment is off, so booking {} gets no PayPal order", bookingId);
            return new PayPalCheckoutUnavailableException();
        });
        PayPalClient.Order order;
        try {
            order = client.createOrder(credentials, bookingId, pending.amountMinor(), pending.currency(),
                    origin.resolve(RETURN_PATH), origin.resolve(CANCEL_PATH));
        } catch (PayPalUnavailableException | PayPalRefusedException failed) {
            log.warn("PayPal created no order for booking {}: {}", bookingId, failed.getMessage());
            throw new PayPalCheckoutUnavailableException();
        }
        URI approveUrl = order.approveUrl().orElseThrow(() -> {
            log.warn("PayPal order {} of booking {} came without an approve link", order.id(), bookingId);
            return new PayPalCheckoutUnavailableException();
        });
        StoredOrder fresh = new StoredOrder(order.id(), bookingId, account, credentials.environment(),
                pending.amountMinor(), pending.currency(), Status.CREATED, approveUrl);
        return transactions.execute(status -> {
            if (orders.insert(fresh)) {
                events.publishEvent(new PaymentEvent.PayPalOrderCreated(bookingId, fresh.orderId(),
                        fresh.environment(), fresh.amountMinor(), fresh.currency().getCurrencyCode()));
            }
            return created(orders.ofBooking(bookingId).orElseThrow(() -> new IllegalStateException(
                    "Booking " + bookingId + " lost its PayPal order")));
        });
    }

    /** Captures the signed-in booker's order after their return from PayPal. */
    public Settlement capture(String orderId) {
        return settle(owned(orderId));
    }

    /** Captures an order on nobody's behalf, as reconciliation does. */
    public Settlement settle(String orderId) {
        return settle(orders.find(orderId).orElseThrow(PayPalOrderNotFoundException::new));
    }

    /** Ends the signed-in booker's order when PayPal shows no money taken; otherwise it is settled or left open. */
    public Settlement cancel(String orderId) {
        StoredOrder stored = owned(orderId);
        requireNoTransaction();
        Optional<Settlement> settled = settled(stored);
        if (settled.isPresent()) return settled.get();
        Optional<PayPalClient.Credentials> credentials = settings.activeCredentials()
                .filter(active -> active.environment() == stored.environment());
        if (credentials.isEmpty()) return processing(stored);
        PayPalClient.Order order;
        try {
            order = client.getOrder(credentials.get(), stored.orderId());
        } catch (PayPalUnavailableException | PayPalRefusedException failed) {
            log.warn("PayPal order {} of booking {} could not be read before its cancel: {}", stored.orderId(),
                    stored.bookingId(), failed.getMessage());
            return processing(stored);
        }
        if (order.capture().isPresent()) {
            return settle(stored, order.capture().get(), mismatch(stored, order).isEmpty());
        }
        return UNCAPTURED.contains(order.status()) ? voided(stored) : processing(stored);
    }

    private Settlement voided(StoredOrder stored) {
        return transactions.execute(status -> {
            StoredOrder locked = lock(stored);
            if (locked.status() != Status.CREATED) return settled(locked).orElseThrow();
            orders.mark(locked.orderId(), Status.VOIDED, null);
            pendingPayments.release(locked.bookingId());
            return new Settlement(locked.bookingId(), Outcome.REJECTED);
        });
    }

    private Settlement settle(StoredOrder stored) {
        requireNoTransaction();
        Optional<Settlement> settled = settled(stored);
        if (settled.isPresent()) return settled.get();
        Optional<PayPalClient.Credentials> credentials = settings.activeCredentials()
                .filter(active -> active.environment() == stored.environment());
        if (credentials.isEmpty()) {
            log.info("PayPal order {} of booking {} waits: no active {} credentials", stored.orderId(),
                    stored.bookingId(), stored.environment());
            return processing(stored);
        }
        PayPalClient.Order order;
        try {
            order = client.getOrder(credentials.get(), stored.orderId());
        } catch (PayPalUnavailableException | PayPalRefusedException failed) {
            log.warn("PayPal order {} of booking {} could not be read: {}", stored.orderId(), stored.bookingId(),
                    failed.getMessage());
            return processing(stored);
        }
        Optional<Rejection> mismatch = mismatch(stored, order);
        if (order.status().equals("COMPLETED")) {
            return order.capture().map(capture -> settle(stored, capture, mismatch.isEmpty()))
                    .orElseGet(() -> processing(stored));
        }
        if (mismatch.isPresent()) return reject(stored, mismatch.get());
        return switch (order.status()) {
            case "APPROVED" -> capture(stored, credentials.get());
            case "VOIDED" -> reject(stored, Rejection.ORDER_VOIDED);
            default -> processing(stored);
        };
    }

    private Settlement capture(StoredOrder stored, PayPalClient.Credentials credentials) {
        try {
            return settle(stored, client.captureOrder(credentials, stored.orderId()), true);
        } catch (PayPalUnavailableException unknown) {
            log.warn("The capture of PayPal order {} of booking {} has no known outcome yet", stored.orderId(),
                    stored.bookingId());
            return processing(stored);
        } catch (PayPalRefusedException refused) {
            log.warn("PayPal refused to capture order {} of booking {}: {}", stored.orderId(), stored.bookingId(),
                    refused.reason());
        }
        try {
            PayPalClient.Order order = client.getOrder(credentials, stored.orderId());
            if (order.capture().isPresent()) return settle(stored, order.capture().get(), true);
            return UNCAPTURED.contains(order.status()) ? reject(stored, Rejection.CAPTURE_REFUSED) : processing(stored);
        } catch (PayPalUnavailableException | PayPalRefusedException failed) {
            log.warn("PayPal order {} of booking {} could not be read after its capture: {}", stored.orderId(),
                    stored.bookingId(), failed.getMessage());
            return processing(stored);
        }
    }

    private Settlement settle(StoredOrder stored, PayPalClient.Capture capture, boolean orderMatches) {
        return switch (capture.status()) {
            case "COMPLETED" -> record(stored, capture, orderMatches);
            case "DECLINED", "FAILED" -> reject(stored, Rejection.CAPTURE_DECLINED);
            default -> processing(stored);
        };
    }

    private Settlement record(StoredOrder stored, PayPalClient.Capture capture, boolean orderMatches) {
        return transactions.execute(status -> {
            StoredOrder locked = lock(stored);
            if (locked.status() == Status.CAPTURED || locked.status() == Status.LATE_CAPTURED) {
                return settled(locked).orElseThrow();
            }
            Currency currency = Currency.getInstance(capture.currency());
            boolean paysTheBooking = orderMatches && capture.amountMinor() == locked.amountMinor()
                    && currency.equals(locked.currency()) && currency.equals(clubCurrency.currency());
            if (paysTheBooking) {
                ConfirmOutcome outcome = pendingPayments.confirm(locked.bookingId());
                if (outcome == ConfirmOutcome.ALREADY_CONFIRMED) {
                    log.error("PayPal order {} with capture {} found its booking confirmed without it",
                            locked.orderId(), capture.id());
                    throw new IllegalStateException("Booking " + locked.bookingId()
                            + " was confirmed without its PayPal order " + locked.orderId());
                }
                if (outcome == ConfirmOutcome.CONFIRMED) {
                    bookingPayments.payByPayPal(locked.accountId(), locked.bookingId(), locked.orderId(),
                            locked.amountMinor(), currency);
                    orders.mark(locked.orderId(), Status.CAPTURED, capture.id());
                    events.publishEvent(new PaymentEvent.PayPalCaptured(locked.bookingId(), locked.orderId(),
                            capture.id(), capture.amountMinor(), capture.currency()));
                    return new Settlement(locked.bookingId(), Outcome.CONFIRMED);
                }
            } else {
                log.warn("PayPal captured another amount for order {} of booking {}", locked.orderId(),
                        locked.bookingId());
                pendingPayments.release(locked.bookingId());
            }
            return lateCapture(locked, capture, currency);
        });
    }

    private Settlement lateCapture(StoredOrder locked, PayPalClient.Capture capture, Currency currency) {
        boolean credited = capture.amountMinor() > 0 && currency.equals(clubCurrency.currency())
                && bookingPayments.creditLateCapture(locked.accountId(), locked.bookingId(), locked.orderId(),
                        capture.amountMinor(), currency);
        orders.mark(locked.orderId(), Status.LATE_CAPTURED, capture.id());
        events.publishEvent(new PaymentEvent.PayPalLateCapture(locked.bookingId(), locked.orderId(), capture.id(),
                capture.amountMinor(), capture.currency(), credited));
        if (credited) {
            log.info("PayPal order {} of booking {} was captured after the hold ended and became credit",
                    locked.orderId(), locked.bookingId());
        } else {
            log.warn("PayPal order {} of booking {} was captured after the hold ended and could not become credit;"
                    + " the treasurer returns it", locked.orderId(), locked.bookingId());
        }
        return new Settlement(locked.bookingId(), Outcome.LATE_CREDITED);
    }

    private Settlement reject(StoredOrder stored, Rejection reason) {
        return transactions.execute(status -> {
            StoredOrder locked = lock(stored);
            if (locked.status() != Status.CREATED) return settled(locked).orElseThrow();
            orders.mark(locked.orderId(), Status.REJECTED, null);
            pendingPayments.release(locked.bookingId());
            events.publishEvent(new PaymentEvent.PayPalRejected(locked.bookingId(), locked.orderId(), reason.name()));
            log.warn("PayPal order {} of booking {} was refused: {}", locked.orderId(), locked.bookingId(), reason);
            return new Settlement(locked.bookingId(), Outcome.REJECTED);
        });
    }

    private StoredOrder lock(StoredOrder stored) {
        return orders.lock(stored.orderId()).orElseThrow(() -> new IllegalStateException(
                "PayPal order " + stored.orderId() + " vanished"));
    }

    private static Optional<Rejection> mismatch(StoredOrder stored, PayPalClient.Order order) {
        if (!order.id().equals(stored.orderId()) || !order.customId().equals(stored.bookingId().toString())) {
            return Optional.of(Rejection.BOOKING_MISMATCH);
        }
        if (!order.currency().equals(stored.currency().getCurrencyCode())) {
            return Optional.of(Rejection.CURRENCY_MISMATCH);
        }
        if (order.amountMinor() != stored.amountMinor()) return Optional.of(Rejection.AMOUNT_MISMATCH);
        return Optional.empty();
    }

    private static Optional<Settlement> settled(StoredOrder order) {
        return switch (order.status()) {
            case CREATED -> Optional.empty();
            case CAPTURED -> Optional.of(new Settlement(order.bookingId(), Outcome.CONFIRMED));
            case LATE_CAPTURED -> Optional.of(new Settlement(order.bookingId(), Outcome.LATE_CREDITED));
            case REJECTED, VOIDED -> Optional.of(new Settlement(order.bookingId(), Outcome.REJECTED));
        };
    }

    private static Settlement processing(StoredOrder order) {
        return new Settlement(order.bookingId(), Outcome.PROCESSING);
    }

    private StoredOrder owned(String orderId) {
        UUID account = signedIn();
        return orders.find(orderId).filter(order -> order.accountId().equals(account))
                .orElseThrow(PayPalOrderNotFoundException::new);
    }

    private UUID signedIn() {
        return currentUser.accountId().orElseThrow(PayPalOrderNotFoundException::new);
    }

    private static CreatedOrder created(StoredOrder order) {
        return new CreatedOrder(order.orderId(), order.approveUrl());
    }

    private static void requireNoTransaction() {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("PayPal is never called while a transaction holds database locks");
        }
    }

    private enum Rejection {
        BOOKING_MISMATCH, CURRENCY_MISMATCH, AMOUNT_MISMATCH, ORDER_VOIDED, CAPTURE_DECLINED, CAPTURE_REFUSED
    }

    public enum Outcome { CONFIRMED, LATE_CREDITED, REJECTED, PROCESSING }

    public record CreatedOrder(String orderId, URI approveUrl) {
    }

    public record Settlement(UUID bookingId, Outcome outcome) {
    }
}
