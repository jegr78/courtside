package org.courtside.identity;

import java.util.UUID;

/** Replaces an account's person details, username and credentials so that its row names nobody. */
public interface AccountAnonymisation {

    void anonymise(UUID accountId);
}
