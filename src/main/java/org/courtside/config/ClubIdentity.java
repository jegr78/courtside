package org.courtside.config;

import java.time.ZoneId;

// What a message has to carry so that a member can tell who wrote to them and when a date falls.
public interface ClubIdentity {

    String clubName();

    String defaultLocale();

    ZoneId zoneId();
}
