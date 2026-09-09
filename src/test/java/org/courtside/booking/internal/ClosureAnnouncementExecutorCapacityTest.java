package org.courtside.booking.internal;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

import static org.assertj.core.api.Assertions.assertThat;

class ClosureAnnouncementExecutorCapacityTest {

    @Test
    void givenTheAnnouncementExecutor_whenReadingItsCapacityPolicy_thenTheQueueIsBoundedAndSaturationUsesCallerRuns() {
        ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) new BookingConfiguration()
                .closureAnnouncementExecutor();

        try {
            assertThat(executor.getThreadPoolExecutor().getQueue().remainingCapacity()).isEqualTo(100);
            assertThat(executor.getThreadPoolExecutor().getRejectedExecutionHandler())
                    .isInstanceOf(ThreadPoolExecutor.CallerRunsPolicy.class);
        } finally {
            executor.shutdown();
        }
    }
}
