package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;

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
        })).isInstanceOf(IllegalStateException.class);

        // then — four tries inside a minute, because a neighbour that is restarting is back by then
        assertThat(attempts).hasValue(4);
        assertThat(gaps).containsExactly(
                Duration.ofSeconds(5), Duration.ofSeconds(15), Duration.ofSeconds(45));
        assertThat(gaps.stream().reduce(Duration.ZERO, Duration::plus))
                .isLessThan(Duration.ofMinutes(2));
    }
}
