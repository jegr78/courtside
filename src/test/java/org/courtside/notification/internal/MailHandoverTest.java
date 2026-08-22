package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class MailHandoverTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final String MESSAGE_ID = "<message@courtside.test>";

    private final List<Duration> gaps = new ArrayList<>();
    private final MailHandover handover =
            new MailHandover(runsImmediately(), Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void givenAServerThatAnswers_whenHandingOver_thenItIsTriedOnceAndNothingIsRescheduled() {
        // given
        AtomicInteger attempts = new AtomicInteger();
        List<Exception> givenUp = new ArrayList<>();

        // when
        handover.attempt(MESSAGE_ID, attempts::incrementAndGet, givenUp::add);

        // then
        assertThat(attempts).hasValue(1);
        assertThat(gaps).isEmpty();
        assertThat(givenUp).isEmpty();
    }

    @Test
    void givenAServerRestarting_whenItAnswersOnTheSecondTry_thenTheMessageIsNotGivenUpOn() {
        // given
        AtomicInteger attempts = new AtomicInteger();
        List<Exception> givenUp = new ArrayList<>();

        // when
        handover.attempt(MESSAGE_ID, () -> {
            if (attempts.incrementAndGet() < 2) {
                throw new IllegalStateException("the server is restarting");
            }
        }, givenUp::add);

        // then
        assertThat(attempts).hasValue(2);
        assertThat(gaps).containsExactly(Duration.ofSeconds(5));
        assertThat(givenUp).isEmpty();
    }

    @Test
    void givenAServerThatStaysAway_whenTheGapsAreExhausted_thenItHasFailedRatherThanWaitedOn() {
        // given
        AtomicInteger attempts = new AtomicInteger();
        List<Exception> givenUp = new ArrayList<>();

        // when
        handover.attempt(MESSAGE_ID, () -> {
            attempts.incrementAndGet();
            throw new IllegalStateException("nothing is listening");
        }, givenUp::add);

        // then — four tries inside a minute, because a neighbour that is restarting is back by then
        assertThat(attempts).hasValue(4);
        assertThat(gaps).containsExactly(
                Duration.ofSeconds(5), Duration.ofSeconds(15), Duration.ofSeconds(45));
        assertThat(gaps.stream().reduce(Duration.ZERO, Duration::plus))
                .isLessThan(Duration.ofMinutes(2));
        assertThat(givenUp).hasSize(1);
    }

    private TaskScheduler runsImmediately() {
        TaskScheduler scheduler = mock(TaskScheduler.class);
        when(scheduler.schedule(any(Runnable.class), any(Instant.class))).thenAnswer(invocation -> {
            gaps.add(Duration.between(NOW, invocation.getArgument(1, Instant.class)));
            invocation.getArgument(0, Runnable.class).run();
            return null;
        });
        return scheduler;
    }
}
