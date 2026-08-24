package org.courtside.rules;

import java.util.List;
import java.util.UUID;

public interface CourtBookingPermission {

    List<RuleViolation> violationsFor(UUID membershipTypeId);
}
