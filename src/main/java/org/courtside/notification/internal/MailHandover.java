package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Duration;

// The mail server is a neighbour in the same network: if it cannot be reached it is restarting, and
// that is over in minutes. Waiting for days would leave a member's access in a state nobody can act on.
@Slf4j
@Component
@RequiredArgsConstructor
class MailHandover {

    private static final int ATTEMPTS = 4;
    private static final Duration FIRST_GAP = Duration.ofSeconds(5);
    private static final int GROWTH = 3;

    private final MailPause pause;

    // Returns only once the message is handed over, so that a caller whose completion is recorded
    // elsewhere records it for a delivery that happened.
    void attempt(String messageId, Runnable handover) {
        Duration gap = FIRST_GAP;
        for (int attempt = 1; ; attempt++) {
            try {
                handover.run();
                return;
            } catch (RuntimeException failure) {
                if (attempt >= ATTEMPTS) {
                    String diagnosis = diagnosis(failure);
                    log.warn("Gave up handing over {} after {} attempts: {}", messageId, attempt,
                            diagnosis);
                    // Without the cause: it escapes into the async handler, which logs the chain,
                    // and a rejected recipient reports the address it rejected.
                    throw new MailHandoverFailedException(messageId, diagnosis);
                }
                log.info("Handing over {} failed on attempt {} ({}), retrying in {}", messageId,
                        attempt, diagnosis(failure), gap);
                pause.untilTheNextAttempt(gap);
                gap = gap.multipliedBy(GROWTH);
            }
        }
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
}
