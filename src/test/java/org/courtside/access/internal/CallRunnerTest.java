package org.courtside.access.internal;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class CallRunnerTest {

    private static final Duration DEADLINE = Duration.ofMillis(300);

    private final CallRunner runner = new CallRunner(DEADLINE);
    private final CountDownLatch releaseStubbornCall = new CountDownLatch(1);

    @AfterEach
    void closeTheRunner() {
        releaseStubbornCall.countDown();
        runner.close();
    }

    @Test
    void givenACallThatAnswers_whenRun_thenItsAnswerIsReturnedFromAnotherThread() {
        // given
        String caller = Thread.currentThread().getName();

        // when
        CallRunner.Result<String> result = runner.run(() -> Thread.currentThread().getName());

        // then
        assertThat(result).isInstanceOf(CallRunner.Result.Done.class);
        assertThat(((CallRunner.Result.Done<String>) result).value()).isNotEqualTo(caller)
                .startsWith("access-control-call");
    }

    @Test
    void givenACallThatHangs_whenTheDeadlinePasses_thenItIsAbandonedAsUnclearAndInterrupted() throws Exception {
        // given
        CountDownLatch interrupted = new CountDownLatch(1);
        long started = System.nanoTime();

        // when
        CallRunner.Result<String> result = runner.run(() -> {
            try {
                Thread.sleep(Duration.ofMinutes(1));
                return "late";
            } catch (InterruptedException cancelled) {
                interrupted.countDown();
                throw cancelled;
            }
        });

        // then
        assertThat(result).isInstanceOf(CallRunner.Result.Unclear.class);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(DEADLINE.multipliedBy(5));
        assertThat(interrupted.await(5, TimeUnit.SECONDS)).as("the abandoned call is interrupted").isTrue();
    }

    @Test
    void givenACallThatThrowsAnError_whenRun_thenTheAnswerIsUnclearAndTheThreadServesTheNextCall() {
        // when
        CallRunner.Result<String> failed = runner.run(() -> {
            throw new AssertionError("connector bug");
        });
        CallRunner.Result<String> next = runner.run(() -> "answered");

        // then
        assertThat(failed).isInstanceOf(CallRunner.Result.Unclear.class);
        assertThat(next).isEqualTo(new CallRunner.Result.Done<>("answered"));
    }

    @Test
    void givenACallThatIgnoresItsInterrupt_whenTheNextCallComes_thenItIsBusyAndNeverStarts() {
        // given
        AtomicInteger started = new AtomicInteger();
        CallRunner.Result<String> abandoned = runner.run(() -> {
            started.incrementAndGet();
            while (true) {
                try {
                    if (releaseStubbornCall.await(1, TimeUnit.MINUTES)) {
                        return "released";
                    }
                } catch (InterruptedException ignored) {
                    Thread.onSpinWait();
                }
            }
        });

        // when
        CallRunner.Result<String> next = runner.run(() -> {
            started.incrementAndGet();
            return "second";
        });

        // then
        assertThat(abandoned).isInstanceOf(CallRunner.Result.Unclear.class);
        assertThat(next).isInstanceOf(CallRunner.Result.Busy.class);
        assertThat(started).as("a second call never runs beside the first").hasValue(1);
    }

    @Test
    void givenCallsThatEndedNormally_whenTheNextFollowsAtOnce_thenNoneIsReportedBusy() {
        // given
        AtomicBoolean overlapping = new AtomicBoolean();
        AtomicInteger running = new AtomicInteger();
        List<CallRunner.Result<Integer>> results = new ArrayList<>();

        // when
        for (int call = 0; call < 500; call++) {
            int number = call;
            results.add(runner.run(() -> {
                overlapping.compareAndSet(false, running.incrementAndGet() > 1);
                running.decrementAndGet();
                return number;
            }));
        }

        // then
        assertThat(results).allMatch(result -> result instanceof CallRunner.Result.Done);
        assertThat(overlapping).isFalse();
    }
}
