package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MailHandoverTest {

    private static final String MESSAGE_ID = "<message@courtside.test>";

    private final List<Duration> gaps = new ArrayList<>();
    private final MailHandover handover = new MailHandover(gaps::add);

    @Test
    void givenAServerThatAnswers_whenHandingOver_thenItIsTriedOnceAndNothingIsRepeated() {
        // given
        AtomicInteger attempts = new AtomicInteger();

        // when
        handover.attempt(MESSAGE_ID, attempts::incrementAndGet);

        // then
        assertThat(attempts).hasValue(1);
        assertThat(gaps).isEmpty();
    }

    @Test
    void givenAServerRestarting_whenItAnswersOnTheSecondTry_thenTheMessageIsNotGivenUpOn() {
        // given
        AtomicInteger attempts = new AtomicInteger();

        // when
        handover.attempt(MESSAGE_ID, () -> {
            if (attempts.incrementAndGet() < 2) {
                throw new IllegalStateException("the server is restarting");
            }
        });

        // then
        assertThat(attempts).hasValue(2);
        assertThat(gaps).containsExactly(Duration.ofSeconds(5));
    }

    @Test
    void givenAServerThatStaysAway_whenTheGapsAreExhausted_thenTheHandoverFailsRatherThanReturning() {
        // given
        AtomicInteger attempts = new AtomicInteger();

        // when / then
        assertThatThrownBy(() -> handover.attempt(MESSAGE_ID, () -> {
            attempts.incrementAndGet();
            throw new IllegalStateException("nothing is listening");
        })).isInstanceOf(MailHandoverFailedException.class);

        // then — four tries inside a minute, because a neighbour that is restarting is back by then
        assertThat(attempts).hasValue(4);
        assertThat(gaps).containsExactly(
                Duration.ofSeconds(5), Duration.ofSeconds(15), Duration.ofSeconds(45));
        assertThat(gaps.stream().reduce(Duration.ZERO, Duration::plus))
                .isLessThan(Duration.ofMinutes(2));
    }

    @Test
    void givenARelayThatNamesTheRecipient_whenGivingUp_thenWhatEscapesDoesNotCarryTheAddress() {
        // given — a rejected recipient is reported with the address it rejected
        Runnable rejecting = () -> {
            throw new IllegalStateException("550 5.1.1 <jane.doe@example.org> recipient unknown");
        };

        // when / then — the listener is async, so whatever escapes is logged with its whole chain
        assertThatThrownBy(() -> handover.attempt(MESSAGE_ID, rejecting))
                .satisfies(failure -> assertThat(fullTrace(failure))
                        .as("no log line may carry a member's address")
                        .doesNotContain("jane.doe@example.org")
                        .contains(MESSAGE_ID)
                        .contains("IllegalStateException"));
    }

    private static String fullTrace(Throwable failure) {
        StringWriter rendered = new StringWriter();
        failure.printStackTrace(new PrintWriter(rendered));
        return rendered.toString();
    }

}
