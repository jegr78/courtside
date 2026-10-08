package org.courtside.shared.web;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.LongSupplier;

final class RequestBudgets {

    private static final long NANOS_PER_SECOND = Duration.ofSeconds(1).toNanos();

    private final Map<String, Bucket> buckets;
    private final LongSupplier nanoTime;

    RequestBudgets(int trackedPrincipals, LongSupplier nanoTime) {
        if (trackedPrincipals < 1) {
            throw new IllegalStateException("At least one principal must be tracked");
        }
        this.nanoTime = nanoTime;
        this.buckets = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Bucket> eldest) {
                return size() > trackedPrincipals;
            }
        };
    }

    synchronized Optional<Refusal> spend(String principal, RequestBudget budget, int cost) {
        long now = nanoTime.getAsLong();
        Bucket bucket = buckets.computeIfAbsent(principal, ignored -> new Bucket(budget.burst(), now));
        bucket.refill(budget, now);
        if (bucket.tokens >= cost) {
            bucket.tokens -= cost;
            bucket.refusing = false;
            return Optional.empty();
        }
        double missing = cost - bucket.tokens;
        boolean first = !bucket.refusing;
        bucket.refusing = true;
        return Optional.of(new Refusal(
                Duration.ofNanos((long) Math.ceil(missing * NANOS_PER_SECOND / budget.perSecond())), first));
    }

    synchronized int tracked() {
        return buckets.size();
    }

    record Refusal(Duration retryAfter, boolean first) {
    }

    private static final class Bucket {

        private double tokens;
        private boolean refusing;
        private long refilledAt;

        private Bucket(double tokens, long refilledAt) {
            this.tokens = tokens;
            this.refilledAt = refilledAt;
        }

        private void refill(RequestBudget budget, long now) {
            long elapsed = Math.max(0, now - refilledAt);
            tokens = Math.min(budget.burst(), tokens + (double) elapsed * budget.perSecond() / NANOS_PER_SECOND);
            refilledAt = now;
        }
    }
}
