package org.courtside.booking.attendance;

import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.util.Optional;

/** {@code releaseAfterMinutes} frees a booking nobody checked in for that long after its start; {@code null} never does. */
public record AttendancePolicy(boolean enabled, @Nullable Integer releaseAfterMinutes) {

    public static final int MIN_RELEASE_MINUTES = 5;
    public static final int MAX_RELEASE_MINUTES = 120;

    public AttendancePolicy {
        if (releaseAfterMinutes != null && !enabled) {
            throw new AttendancePolicyInvalidException("attendance.policy.releaseNeedsAttendance");
        }
        if (releaseAfterMinutes != null
                && (releaseAfterMinutes < MIN_RELEASE_MINUTES || releaseAfterMinutes > MAX_RELEASE_MINUTES)) {
            throw new AttendancePolicyInvalidException("attendance.policy.releaseOutOfRange");
        }
    }

    public Optional<Duration> releaseAfter() {
        return Optional.ofNullable(releaseAfterMinutes).map(Duration::ofMinutes);
    }
}
