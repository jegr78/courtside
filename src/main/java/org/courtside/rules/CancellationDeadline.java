package org.courtside.rules;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface CancellationDeadline {

    Optional<RuleViolation> violationFor(UUID membershipTypeId, Instant startsAt, Instant cancelledAt);
}
