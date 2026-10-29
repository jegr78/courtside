package org.courtside.access.internal;

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

/** Runs one remote call at a time on its own thread, bounded by the connector's deadline. */
final class CallRunner implements AutoCloseable {

    sealed interface Result<T> {

        record Done<T>(T value) implements Result<T> {
        }

        /** The call threw or missed its deadline; it may have been applied. */
        record Unclear<T>() implements Result<T> {
        }

        /** An earlier call still occupies the call thread, so this one was never started. */
        record Busy<T>() implements Result<T> {
        }
    }

    private final Duration deadline;
    private final ExecutorService thread;
    private final AtomicBoolean occupied = new AtomicBoolean();

    CallRunner(Duration deadline) {
        this.deadline = deadline;
        this.thread = Executors.newSingleThreadExecutor(Thread.ofPlatform().name("access-control-call").daemon()
                .factory());
    }

    <T> Result<T> run(Callable<T> call) {
        if (!occupied.compareAndSet(false, true)) {
            return new Result.Busy<>();
        }
        Future<T> running;
        try {
            running = thread.submit(() -> {
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
            running.cancel(true);
            return new Result.Unclear<>();
        } catch (ExecutionException failed) {
            return new Result.Unclear<>();
        } catch (InterruptedException interrupted) {
            running.cancel(true);
            Thread.currentThread().interrupt();
            return new Result.Unclear<>();
        }
    }

    @Override
    public void close() {
        thread.shutdownNow();
    }
}
