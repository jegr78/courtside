package org.courtside.identity.internal;

import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
public final class LoginVerificationCapacity {

    private final Semaphore available;

    LoginVerificationCapacity(LoginProtectionProperties properties) {
        available = new Semaphore(properties.verificationConcurrency(), true);
    }

    public Optional<Permit> tryAcquire() {
        return available.tryAcquire() ? Optional.of(new Permit(available)) : Optional.empty();
    }

    public static final class Permit implements AutoCloseable {

        private final Semaphore available;
        private final AtomicBoolean closed = new AtomicBoolean();

        private Permit(Semaphore available) {
            this.available = available;
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                available.release();
            }
        }
    }
}
