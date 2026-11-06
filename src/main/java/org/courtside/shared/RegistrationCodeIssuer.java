package org.courtside.shared;

import java.util.Optional;
import java.util.UUID;

public interface RegistrationCodeIssuer {

    Optional<IssuedRegistrationCode> issueFor(UUID accountId);
}
