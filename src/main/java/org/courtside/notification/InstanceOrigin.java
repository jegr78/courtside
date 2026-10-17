package org.courtside.notification;

import java.util.Optional;

public interface InstanceOrigin {

    /** The origin messages link to, empty when the instance has no public address configured. */
    Optional<String> origin();
}
