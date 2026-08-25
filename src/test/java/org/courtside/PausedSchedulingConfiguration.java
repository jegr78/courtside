package org.courtside;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.Trigger;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Delayed;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

// A sweep that fires on its own writes to the tables every test truncates between cases, which
// deadlocks the cleanup instead of testing anything. Tests call the sweeps they mean to exercise.
@TestConfiguration(proxyBeanMethods = false)
public class PausedSchedulingConfiguration {

    @Bean
    TaskScheduler taskScheduler() {
        return new PausedTaskScheduler();
    }

    private static final class PausedTaskScheduler implements TaskScheduler {

        @Override
        public ScheduledFuture<?> schedule(Runnable task, Trigger trigger) {
            return neverRuns();
        }

        @Override
        public ScheduledFuture<?> schedule(Runnable task, Instant startTime) {
            return neverRuns();
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Instant startTime, Duration period) {
            return neverRuns();
        }

        @Override
        public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, Duration period) {
            return neverRuns();
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Instant startTime, Duration delay) {
            return neverRuns();
        }

        @Override
        public ScheduledFuture<?> scheduleWithFixedDelay(Runnable task, Duration delay) {
            return neverRuns();
        }

        private static ScheduledFuture<?> neverRuns() {
            return new PausedFuture();
        }
    }

    private static final class PausedFuture extends CompletableFuture<Object> implements ScheduledFuture<Object> {

        @Override
        public long getDelay(TimeUnit unit) {
            return Long.MAX_VALUE;
        }

        @Override
        public int compareTo(Delayed other) {
            return Long.compare(getDelay(TimeUnit.NANOSECONDS), other.getDelay(TimeUnit.NANOSECONDS));
        }
    }
}
