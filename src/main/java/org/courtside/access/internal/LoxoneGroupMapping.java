package org.courtside.access.internal;

import java.util.Optional;
import java.util.UUID;

/** The Loxone group uuid a board mapped an access point onto; a local read. */
@FunctionalInterface
interface LoxoneGroupMapping {

    Optional<String> groupOf(UUID accessPointId);
}
