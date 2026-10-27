package org.courtside.identity;

import java.util.UUID;

public record ControlledRecoveryRequested(UUID accountId, UUID recoveryId) { }
