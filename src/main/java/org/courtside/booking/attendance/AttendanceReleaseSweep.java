package org.courtside.booking.attendance;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
@Profile("!journey")
@RequiredArgsConstructor
class AttendanceReleaseSweep {

    private final AttendanceRelease release;

    @Scheduled(initialDelay = 45, timeUnit = TimeUnit.SECONDS,
            fixedDelayString = "${courtside.booking.attendance-release-interval}")
    void releaseWhatIsDue() {
        release.releaseDue();
    }
}
