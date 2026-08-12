package org.courtside.config;

import java.time.ZoneId;

public interface ClubTimeZone {

    ZoneId zoneId();

    default String id() {
        return zoneId().getId();
    }
}
