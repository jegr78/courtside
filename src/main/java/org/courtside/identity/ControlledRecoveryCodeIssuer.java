package org.courtside.identity;

import org.courtside.shared.IssuedResetCode;
import java.util.UUID;

public interface ControlledRecoveryCodeIssuer {
    IssuedResetCode issueFor(UUID accountId, UUID recoveryId);
}
