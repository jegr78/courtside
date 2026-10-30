package org.courtside.access.internal;

import java.time.Instant;

/** The pass's time, read once per row transaction so every comparison in it agrees. */
public interface PassClock {

    Instant now();
}
