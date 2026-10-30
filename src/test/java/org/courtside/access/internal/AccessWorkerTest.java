package org.courtside.access.internal;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

class AccessWorkerTest {

    private static final Duration LONG = Duration.ofMinutes(1);

    private final BlockingQueue<Long> started = new LinkedBlockingQueue<>();
    private final List<AccessWorker> workers = new CopyOnWriteArrayList<>();

    @AfterEach
    void stopTheWorkers() {
        workers.forEach(AccessWorker::stop);
    }

    @Test
    void givenASignalDuringAPass_whenThePassEnds_thenTheNextPassStartsAtOnce() throws Exception {
        // given
        CountDownLatch firstPassRunning = new CountDownLatch(1);
        CountDownLatch finishFirstPass = new CountDownLatch(1);
        AccessWorker worker = worker(() -> {
            if (started.size() == 1) {
                firstPassRunning.countDown();
                await(finishFirstPass);
            }
            return new PassResult.Completed();
        }, LONG, LONG);
        worker.start();
        assertThat(firstPassRunning.await(5, TimeUnit.SECONDS)).isTrue();

        // when
        worker.signal();
        finishFirstPass.countDown();

        // then
        assertThat(started.poll(5, TimeUnit.SECONDS)).isNotNull();
        assertThat(started.poll(5, TimeUnit.SECONDS)).as("a signal during a pass is latched, not lost").isNotNull();
    }

    @Test
    void givenACompletedPassAndNoSignal_whenTheIdleTimeoutPasses_thenTheNextPassStarts() throws Exception {
        // given
        AccessWorker worker = worker(PassResult.Completed::new, Duration.ofMillis(300), LONG);

        // when
        worker.start();

        // then
        Long first = started.poll(5, TimeUnit.SECONDS);
        Long second = started.poll(5, TimeUnit.SECONDS);
        assertThat(first).isNotNull();
        assertThat(second).isNotNull();
        assertThat(Duration.ofNanos(second - first)).isGreaterThanOrEqualTo(Duration.ofMillis(300));
    }

    @Test
    void givenAPassThatAskedForAHold_whenSignalsArrive_thenNoPassStartsBeforeTheHoldEnds() throws Exception {
        // given
        AccessWorker worker = worker(() -> new PassResult.Held(Duration.ofMillis(600)), LONG, LONG);
        worker.start();
        Long first = started.poll(5, TimeUnit.SECONDS);
        assertThat(first).isNotNull();

        // when
        worker.signal();
        Thread.sleep(100);
        worker.signal();

        // then
        Long second = started.poll(5, TimeUnit.SECONDS);
        assertThat(second).isNotNull();
        assertThat(Duration.ofNanos(second - first)).as("the system asked for the pause")
                .isGreaterThanOrEqualTo(Duration.ofMillis(600));
    }

    @Test
    void givenAnotherInstanceHoldsTheLock_whenThePassSkips_thenItRetriesAfterTheLockRetryWithoutASignal()
            throws Exception {
        // given
        AccessWorker worker = worker(PassResult.Skipped::new, LONG, Duration.ofMillis(200));

        // when
        worker.start();

        // then
        assertThat(started.poll(5, TimeUnit.SECONDS)).isNotNull();
        assertThat(started.poll(5, TimeUnit.SECONDS)).isNotNull();
    }

    @Test
    void givenAPassThatThrows_whenSignalled_thenTheWorkerKeepsRunningPasses() throws Exception {
        // given
        AccessWorker worker = worker(() -> {
            throw new IllegalStateException("database unavailable");
        }, LONG, LONG);
        worker.start();
        assertThat(started.poll(5, TimeUnit.SECONDS)).isNotNull();

        // when
        worker.signal();

        // then
        assertThat(started.poll(5, TimeUnit.SECONDS)).isNotNull();
        assertThat(worker.isRunning()).isTrue();
    }

    @Test
    void givenARunningWorker_whenItIsStopped_thenItsThreadEndsAndNoPassFollows() throws Exception {
        // given
        AccessWorker worker = worker(PassResult.Completed::new, LONG, LONG);
        worker.start();
        assertThat(started.poll(5, TimeUnit.SECONDS)).isNotNull();

        // when
        worker.stop();
        worker.signal();

        // then
        assertThat(worker.isRunning()).isFalse();
        assertThat(started.poll(500, TimeUnit.MILLISECONDS)).isNull();
        assertThat(Thread.getAllStackTraces().keySet()).noneMatch(thread -> thread.getName().equals("access-worker"));
    }

    private AccessWorker worker(Supplier<PassResult> pass, Duration idle, Duration lockRetry) {
        AccessWorker worker = new AccessWorker(() -> {
            started.add(System.nanoTime());
            return pass.get();
        }, idle, lockRetry, true);
        workers.add(worker);
        return worker;
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }
}
