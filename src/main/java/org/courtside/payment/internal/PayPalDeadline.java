package org.courtside.payment.internal;

import java.time.Duration;

/** The time left for all PayPal calls of one request, measured on the monotonic clock. */
final class PayPalDeadline {

    static final PayPalDeadline NONE = new PayPalDeadline(Long.MAX_VALUE);

    private final long endNanos;

    private PayPalDeadline(long endNanos) {
        this.endNanos = endNanos;
    }

    static PayPalDeadline after(Duration budget) {
        return new PayPalDeadline(System.nanoTime() + budget.toNanos());
    }

    /** Whether at least the given time is left, so a call that must not be cut off may still start. */
    boolean leaves(Duration needed) {
        return this == NONE || endNanos - System.nanoTime() >= needed.toNanos();
    }

    /** The timeout for the next call: the request timeout, or less when the deadline is nearer. */
    Duration timeout(Duration requestTimeout) {
        if (this == NONE) return requestTimeout;
        long left = endNanos - System.nanoTime();
        if (left <= 0) throw new PayPalUnavailableException("The time for this request's PayPal calls is used up");
        return left < requestTimeout.toNanos() ? Duration.ofNanos(left) : requestTimeout;
    }
}
