package org.courtside.shared.web;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;

final class Bulkhead {

    private final Semaphore permits;
    private final Set<String> holders = ConcurrentHashMap.newKeySet();

    Bulkhead(int permits) {
        this.permits = new Semaphore(permits);
    }

    // One permit per principal, so a single caller cannot occupy the whole class.
    boolean tryEnter(String principal) {
        if (!holders.add(principal)) {
            return false;
        }
        if (!permits.tryAcquire()) {
            holders.remove(principal);
            return false;
        }
        return true;
    }

    void leave(String principal) {
        if (holders.remove(principal)) {
            permits.release();
        }
    }
}
