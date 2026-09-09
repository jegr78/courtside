package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

import static org.assertj.core.api.Assertions.assertThat;

class NotificationExecutorCapacityTest {

    @Test
    void givenTheMailExecutors_whenReadingTheirCapacityPolicy_thenQueuesAreBoundedAndSaturationUsesCallerRuns() {
        NotificationConfiguration configuration = new NotificationConfiguration();

        for (ThreadPoolTaskExecutor executor : new ThreadPoolTaskExecutor[] {
                (ThreadPoolTaskExecutor) configuration.credentialMailExecutor(),
                (ThreadPoolTaskExecutor) configuration.bookingMailExecutor()
        }) {
            try {
                assertThat(executor.getThreadPoolExecutor().getQueue().remainingCapacity())
                        .isEqualTo(100);
                assertThat(executor.getThreadPoolExecutor().getRejectedExecutionHandler())
                        .isInstanceOf(ThreadPoolExecutor.CallerRunsPolicy.class);
            } finally {
                executor.shutdown();
            }
        }
    }
}
