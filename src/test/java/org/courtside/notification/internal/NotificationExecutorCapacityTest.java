package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

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

    @Test
    void givenAHandoverInProgress_whenTheExecutorShutsDown_thenTheHandoverFinishesInsteadOfBeingInterrupted()
            throws InterruptedException {
        // given
        ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) new NotificationConfiguration()
                .mailOutboxExecutor();
        CountDownLatch started = new CountDownLatch(1);
        AtomicBoolean finished = new AtomicBoolean();
        executor.execute(() -> {
            started.countDown();
            try {
                Thread.sleep(300);
                finished.set(true);
            } catch (InterruptedException interruption) {
                Thread.currentThread().interrupt();
            }
        });
        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();

        // when
        executor.shutdown();

        // then
        assertThat(finished)
                .as("a deploy waits for a message that is half sent rather than cutting it off")
                .isTrue();
    }

    @Test
    void whenTheMailSenderIsBuilt_thenEveryWaitOnTheRelayIsBounded() {
        // given
        MailProperties properties = new MailProperties("mail.example.org", 587, "noreply@example.org",
                "board@example.org", null, null, false);

        // when
        JavaMailSenderImpl sender = (JavaMailSenderImpl) new NotificationConfiguration().courtsideMailSender(properties);

        // then
        assertThat(sender.getJavaMailProperties())
                .as("a relay that stops reading mid-message must not hold a worker forever")
                .containsEntry("mail.smtp.connectiontimeout", "10000")
                .containsEntry("mail.smtp.timeout", "10000")
                .containsEntry("mail.smtp.writetimeout", "10000");
    }

    private static void awaitQuietly(CountDownLatch latch) {
        try {
            latch.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException interruption) {
            Thread.currentThread().interrupt();
        }
    }
}
