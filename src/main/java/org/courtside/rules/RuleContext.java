package org.courtside.rules;

import org.courtside.shared.TimeSlot;

import java.util.UUID;

public record RuleContext(
        UUID courtId,
        UUID cardId,
        TimeSlot slot,
        UUID userAccountId,
        UUID membershipTypeId) {
}
