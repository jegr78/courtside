package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.mail.MailSendException;
import org.springframework.stereotype.Component;

import jakarta.mail.SendFailedException;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

// The mail server is a neighbour in the same network: if it cannot be reached it is restarting, and
// that is over in minutes. Waiting for days would leave a member's access in a state nobody can act on.
@Slf4j
@Component
@RequiredArgsConstructor
class MailHandover {

    private static final int ATTEMPTS = 4;
    private static final Duration FIRST_GAP = Duration.ofSeconds(5);
    private static final int GROWTH = 3;
    private static final Pattern STATUS_CODE = Pattern.compile("^[45]\\d\\d");

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
                if (refusedRecipient(failure) != null) {
                    log.info("Handing over {} was refused: {}", messageId, diagnosis(failure));
                    throw new MailRecipientRefusedException(messageId, diagnosis(failure),
                            statusCode(failure));
                }
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

    // A recipient the relay named as invalid, anywhere in the failure. Everything else is transport,
    // which is what the ladder exists for.
    private static SendFailedException refusedRecipient(Throwable failure) {
        return reportedBy(failure).stream()
                .filter(SendFailedException.class::isInstance)
                .map(SendFailedException.class::cast)
                .filter(refusal -> refusal.getInvalidAddresses() != null
                        && refusal.getInvalidAddresses().length > 0)
                .findFirst()
                .orElse(null);
    }

    // Spring reports a per-message failure through MailSendException's failedMessages and not
    // through its cause, so what a real relay answered is on no cause chain at all.
    private static List<Throwable> reportedBy(Throwable failure) {
        List<Throwable> found = new ArrayList<>();
        Deque<Throwable> pending = new ArrayDeque<>();
        pending.add(failure);
        while (!pending.isEmpty()) {
            Throwable next = pending.poll();
            if (found.contains(next)) {
                continue;
            }
            found.add(next);
            // ArrayDeque rejects a null, and the end of a cause chain is exactly that.
            if (next.getCause() != null) {
                pending.add(next.getCause());
            }
            if (next instanceof MailSendException collected) {
                collected.getFailedMessages().values().stream()
                        .filter(Objects::nonNull)
                        .forEach(pending::add);
            }
        }
        return found;
    }

    // The reply's leading status code and nothing after it: what follows is the relay's own words
    // about an address, and this instance has no business storing those.
    private static String statusCode(Throwable failure) {
        return reportedBy(failure).stream()
                .map(reported -> STATUS_CODE.matcher(String.valueOf(reported.getMessage())))
                .filter(Matcher::find)
                .map(Matcher::group)
                .findFirst()
                .orElse(null);
    }

    // The types and nothing else: a rejected recipient reports the address it rejected, and an
    // operator diagnosing a relay needs the failure, not the member.
    private static String diagnosis(Throwable failure) {
        // Skipping our own wrapper: what a reader needs is what the mail library reported, and the
        // type this class throws around it says nothing it does not already know.
        Throwable reported = failure instanceof MailHandoverFailedException && failure.getCause() != null
                ? failure.getCause()
                : failure;
        return reportedBy(reported).stream()
                .map(cause -> cause.getClass().getSimpleName())
                .collect(Collectors.joining(" <- "));
    }
}
