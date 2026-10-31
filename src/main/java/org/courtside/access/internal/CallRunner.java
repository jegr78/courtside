package org.courtside.access.internal;

import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.LockSupport;

/** Runs one remote call at a time on its own thread, bounded by the connector's deadline. */
final class CallRunner implements AutoCloseable {

    sealed interface Result<T> {

        record Done<T>(T value) implements Result<T> {
        }

        /** The call threw, or missed its deadline when the cause is null; it may have been applied. */
        record Unclear<T>(@Nullable Throwable cause) implements Result<T> {
        }

        /** An earlier call still occupies the call thread, so this one was never started. */
        record Busy<T>() implements Result<T> {
        }
    }

    private static final Duration IDLE_POLL = Duration.ofMillis(10);

    private final Duration deadline;
    private final ExecutorService thread;
    private final AtomicBoolean occupied = new AtomicBoolean();

    CallRunner(Duration deadline) {
        this(deadline, Executors.newSingleThreadExecutor(Thread.ofPlatform().name("access-control-call").daemon()
                .factory()));
    }

    CallRunner(Duration deadline, ExecutorService thread) {
        this.deadline = deadline;
        this.thread = thread;
    }

    <T> Result<T> run(Callable<T> call) {
        if (!occupied.compareAndSet(false, true)) {
            return new Result.Busy<>();
        }
        AtomicBoolean started = new AtomicBoolean();
        Future<T> running;
        try {
            running = thread.submit(() -> {
                if (!started.compareAndSet(false, true)) {
                    return null;
                }
                try {
                    return call.call();
                } finally {
                    occupied.set(false);
                }
            });
        } catch (RejectedExecutionException closed) {
            occupied.set(false);
            return new Result.Busy<>();
        }
        try {
            return new Result.Done<>(running.get(deadline.toNanos(), TimeUnit.NANOSECONDS));
        } catch (TimeoutException late) {
            abandon(running, started);
            return new Result.Unclear<>(null);
        } catch (ExecutionException failed) {
            return new Result.Unclear<>(failed.getCause());
        } catch (InterruptedException interrupted) {
            abandon(running, started);
            Thread.currentThread().interrupt();
            return new Result.Unclear<>(interrupted);
        }
    }

    /** Waits at most this long for an abandoned call to give the call thread back. */
    void awaitIdle(Duration most) {
        long end = System.nanoTime() + most.toNanos();
        while (occupied.get() && System.nanoTime() < end && !Thread.currentThread().isInterrupted()) {
            LockSupport.parkNanos(IDLE_POLL.toNanos());
        }
    }

    private void abandon(Future<?> running, AtomicBoolean started) {
        running.cancel(true);
        if (started.compareAndSet(false, true)) {
            occupied.set(false);
        }
    }

    @Override
    public void close() {
        thread.shutdownNow();
    }
}
