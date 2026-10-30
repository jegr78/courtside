package org.courtside.access.internal;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

public final class SettablePassClock implements PassClock {

    private final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-05-12T10:00:00Z"));
    private final AtomicLong reads = new AtomicLong();

    @Override
    public Instant now() {
        reads.incrementAndGet();
        return now.get();
    }

    public long reads() {
        return reads.get();
    }

    public void set(Instant instant) {
        now.set(instant);
    }

    public void advance(Duration duration) {
        now.updateAndGet(current -> current.plus(duration));
    }

    @TestConfiguration(proxyBeanMethods = false)
    public static class Configuration {

        @Bean
        @Primary
        SettablePassClock settablePassClock() {
            return new SettablePassClock();
        }
    }
}
