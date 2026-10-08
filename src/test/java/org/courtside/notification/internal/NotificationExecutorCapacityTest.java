package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class NotificationExecutorCapacityTest {

    @Test
    void givenTheOutboxExecutor_whenReadingItsCapacity_thenItHoldsTwoWorkersAndOnePendingPass() {
        // given
        ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) new NotificationConfiguration()
                .mailOutboxExecutor();

        try {
            // when
            ThreadPoolExecutor pool = executor.getThreadPoolExecutor();

            // then
            assertThat(pool.getMaximumPoolSize()).as("at most two relay connections at a time").isEqualTo(2);
            assertThat(pool.getQueue().remainingCapacity())
                    .as("one pending pass finds every row a discarded wake-up would have found")
                    .isEqualTo(1);
            assertThat(pool.getRejectedExecutionHandler())
                    .as("a saturated outbox must never hand its work to the publishing thread")
                    .isNotInstanceOf(ThreadPoolExecutor.CallerRunsPolicy.class);
        } finally {
            executor.shutdown();
        }
    }

    @Test
    void givenASaturatedOutboxExecutor_whenMoreWakeUpsArrive_thenNoneRunsOnTheCallersThread() {
        // given
        ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) new NotificationConfiguration()
                .mailOutboxExecutor();
        CountDownLatch relayAnswers = new CountDownLatch(1);
        Set<String> runners = ConcurrentHashMap.newKeySet();
        String caller = Thread.currentThread().getName();

        try {
            // when
            for (int wakeUp = 0; wakeUp < 20; wakeUp++) {
                executor.execute(() -> {
                    runners.add(Thread.currentThread().getName());
                    awaitQuietly(relayAnswers);
                });
            }
            relayAnswers.countDown();

            // then
            assertThat(runners)
                    .as("the thread that published an event must never deliver its mail")
                    .doesNotContain(caller)
                    .allSatisfy(runner -> assertThat(runner).startsWith("mail-outbox-"));
        } finally {
            executor.shutdown();
        }
    }

    private static void awaitQuietly(CountDownLatch latch) {
        try {
            latch.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException interruption) {
            Thread.currentThread().interrupt();
        }
    }
}
