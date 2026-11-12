package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@Profile("!journey")
@RequiredArgsConstructor
class ReadNotificationExpirySchedule {

    private final ReadNotificationExpiry expiry;

    @Scheduled(initialDelayString = "PT1H", fixedDelayString = "PT1H")
    void deleteExpired() {
        expiry.deleteExpired();
    }
}
