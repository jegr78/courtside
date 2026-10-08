package org.courtside.shared.web;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

final class Bulkhead {

    private final Semaphore permits;
    private final Map<String, Turn> turns = new HashMap<>();

    Bulkhead(int permits) {
        this.permits = new Semaphore(permits, true);
    }

    // A principal's own requests queue behind each other, so one caller never holds more than one place.
    boolean tryEnter(String principal, Duration wait) {
        long deadline = System.nanoTime() + wait.toNanos();
        Turn turn = join(principal);
        boolean ownTurn = false;
        boolean entered = false;
        try {
            ownTurn = turn.order.tryAcquire(wait.toNanos(), TimeUnit.NANOSECONDS);
            entered = ownTurn && permits.tryAcquire(Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
            return entered;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        } finally {
            if (!entered) {
                if (ownTurn) {
                    turn.order.release();
                }
                leaveQueue(principal);
            }
        }
    }

    void leave(String principal) {
        Turn turn;
        synchronized (turns) {
            turn = turns.get(principal);
        }
        if (turn == null) {
            throw new IllegalStateException("A bulkhead was left by a principal that never entered it");
        }
        permits.release();
        turn.order.release();
        leaveQueue(principal);
    }

    private Turn join(String principal) {
        synchronized (turns) {
            Turn turn = turns.computeIfAbsent(principal, ignored -> new Turn());
            turn.queued++;
            return turn;
        }
    }

    private void leaveQueue(String principal) {
        synchronized (turns) {
            Turn turn = turns.get(principal);
            if (turn != null && --turn.queued == 0) {
                turns.remove(principal);
            }
        }
    }

    private static final class Turn {

        private final Semaphore order = new Semaphore(1, true);
        private int queued;
    }
}
