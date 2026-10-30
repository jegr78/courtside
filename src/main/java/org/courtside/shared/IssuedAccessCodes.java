package org.courtside.shared;

import java.util.Optional;
import java.util.UUID;

/** A booking's own code from the access-control system; the caller checks that whoever is shown it takes part. */
public interface IssuedAccessCodes {

    boolean issuesCodes();

    // Only once a door accepted it and while the booking still wants it.
    Optional<String> codeOf(UUID bookingId);
}
