package org.courtside.notification.internal;

import org.springframework.stereotype.Component;

import java.time.Duration;

@FunctionalInterface
interface MailPause {

    void untilTheNextAttempt(Duration gap);

    @Component
    class Sleeping implements MailPause {

        @Override
        public void untilTheNextAttempt(Duration gap) {
            try {
                Thread.sleep(gap);
            } catch (InterruptedException interruption) {
                Thread.currentThread().interrupt();
                throw new MailHandoverInterruptedException(interruption);
            }
        }
    }
}
