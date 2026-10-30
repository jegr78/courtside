package org.courtside.notification.internal;

import org.courtside.facility.FacilityEvent;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

import static org.assertj.core.api.Assertions.assertThat;

class MembersDoorCodeExecutorTest {

    @Test
    void whenReadingWhereTheDoorCodeWalkRuns_thenItIsTheNotificationModulesOwnExecutor() throws Exception {
        // when
        Async async = MembersDoorCodeMailer.class
                .getDeclaredMethod("on", FacilityEvent.MembersDoorCodeChanged.class).getAnnotation(Async.class);

        // then
        assertThat(async.value()).as("notification does not borrow an executor booking owns")
                .isEqualTo("membersDoorCodeExecutor");
    }

    @Test
    void givenTheDoorCodeExecutor_whenReadingItsCapacityPolicy_thenTheQueueIsBoundedAndSaturationUsesCallerRuns() {
        // given
        ThreadPoolTaskExecutor executor = (ThreadPoolTaskExecutor) new NotificationConfiguration()
                .membersDoorCodeExecutor();

        // when / then
        try {
            assertThat(executor.getThreadPoolExecutor().getQueue().remainingCapacity()).isEqualTo(100);
            assertThat(executor.getThreadPoolExecutor().getRejectedExecutionHandler())
                    .isInstanceOf(ThreadPoolExecutor.CallerRunsPolicy.class);
        } finally {
            executor.shutdown();
        }
    }
}
