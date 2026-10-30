package org.courtside.access.internal;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.SmartLifecycle;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/** The one thread that runs access passes; everything else only signals it. */
@Slf4j
@Component
@ConnectorSelected
class AccessWorker implements SmartLifecycle {

    private static final Duration IDLE = Duration.ofSeconds(60);
    private static final Duration LOCK_RETRY = Duration.ofSeconds(5);
    private static final Duration STOP_WAIT = Duration.ofSeconds(30);

    private final Supplier<PassResult> pass;
    private final Duration idle;
    private final Duration lockRetry;
    private final boolean autoStartup;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition wake = lock.newCondition();
    private boolean signalled;
    private volatile boolean running;
    private Thread thread;

    @Autowired
    AccessWorker(AccessPass pass, Environment environment) {
        this(pass::runPassNow, IDLE, LOCK_RETRY, !environment.acceptsProfiles(Profiles.of("test")));
    }

    AccessWorker(Supplier<PassResult> pass, Duration idle, Duration lockRetry, boolean autoStartup) {
        this.pass = pass;
        this.idle = idle;
        this.lockRetry = lockRetry;
        this.autoStartup = autoStartup;
    }

    void signal() {
        lock.lock();
        try {
            signalled = true;
            wake.signalAll();
        } finally {
            lock.unlock();
        }
    }

    @Override
    public synchronized void start() {
        if (running) {
            return;
        }
        running = true;
        thread = Thread.ofPlatform().name("access-worker").start(this::work);
    }

    @Override
    public void stop() {
        Thread worker;
        synchronized (this) {
            running = false;
            worker = thread;
        }
        signal();
        if (worker == null) {
            return;
        }
        try {
            worker.join(STOP_WAIT);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public boolean isRunning() {
        Thread worker = thread;
        return running && worker != null && worker.isAlive();
    }

    @Override
    public boolean isAutoStartup() {
        return autoStartup;
    }

    private void work() {
        while (running) {
            clearSignal();
            PassResult result;
            try {
                result = pass.get();
            } catch (RuntimeException failed) {
                log.warn("An access pass failed", failed);
                result = new PassResult.Outage();
            }
            waitAfter(result);
        }
    }

    private void clearSignal() {
        lock.lock();
        try {
            signalled = false;
        } finally {
            lock.unlock();
        }
    }

    private void waitAfter(PassResult result) {
        Duration wait = switch (result) {
            case PassResult.Skipped skipped -> lockRetry;
            case PassResult.Held(Duration held) -> held.isNegative() ? Duration.ZERO : held;
            default -> idle;
        };
        boolean signalsWait = result instanceof PassResult.Held;
        long deadline = System.nanoTime() + wait.toNanos();
        lock.lock();
        try {
            while (running && (signalsWait || !signalled)) {
                long left = deadline - System.nanoTime();
                if (left <= 0) {
                    return;
                }
                wake.awaitNanos(left);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            running = false;
        } finally {
            lock.unlock();
        }
    }
}
