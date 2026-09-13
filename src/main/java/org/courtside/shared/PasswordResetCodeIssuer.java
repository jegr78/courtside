package org.courtside.shared;

import java.util.UUID;

public interface PasswordResetCodeIssuer {

    IssuedResetCode issueFor(UUID accountId);
}
