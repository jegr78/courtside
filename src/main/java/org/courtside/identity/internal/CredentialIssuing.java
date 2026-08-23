package org.courtside.identity.internal;

import java.util.UUID;

// The base package holds the operation a board reaches; how often it may be reached is decided here.
public interface CredentialIssuing {

    void registerOrRefuse(UUID accountId);
}
