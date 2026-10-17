package org.courtside.dataexchange;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

public enum RetentionCategory {
    BOOKINGS,
    FORMER_MEMBERS;

    /** The change-log subject for this category's period, stable across instances. */
    public UUID subjectId() {
        return UUID.nameUUIDFromBytes(("retention:" + name()).getBytes(StandardCharsets.UTF_8));
    }
}
