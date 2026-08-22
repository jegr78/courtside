package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.function.Consumer;

// The mail server is a neighbour in the same network: if it cannot be reached it is restarting, and
// that is over in minutes. Waiting for days would leave a member's access in a state nobody can act on.
@Slf4j
@Component
@RequiredArgsConstructor
class MailHandover {

    private static final int ATTEMPTS = 4;
    private static final Duration FIRST_GAP = Duration.ofSeconds(5);
    private static final int GROWTH = 3;

    private final TaskScheduler scheduler;
    private final Clock clock;

    void attempt(String messageId, Runnable handover, Consumer<Exception> givenUp) {
        run(messageId, handover, givenUp, 1, FIRST_GAP);
    }

    // The types and nothing else: a rejected recipient reports the address it rejected, and an
    // operator diagnosing a relay needs the failure, not the member.
    private static String diagnosis(Throwable failure) {
        StringBuilder chain = new StringBuilder();
        for (Throwable cause = failure; cause != null && cause != cause.getCause();
             cause = cause.getCause()) {
            chain.append(chain.isEmpty() ? "" : " <- ").append(cause.getClass().getSimpleName());
        }
        return chain.toString();
    }

    private void run(String messageId, Runnable handover, Consumer<Exception> givenUp,
                     int attempt, Duration gap) {
        try {
            handover.run();
        } catch (RuntimeException failure) {
            if (attempt >= ATTEMPTS) {
                log.warn("Gave up handing over {} after {} attempts: {}", messageId, attempt,
                        diagnosis(failure));
                givenUp.accept(failure);
                return;
            }
            log.info("Handing over {} failed on attempt {} ({}), retrying in {}", messageId, attempt,
                    diagnosis(failure), gap);
            scheduler.schedule(() -> run(messageId, handover, givenUp, attempt + 1,
                    gap.multipliedBy(GROWTH)), clock.instant().plus(gap));
        }
    }
}
