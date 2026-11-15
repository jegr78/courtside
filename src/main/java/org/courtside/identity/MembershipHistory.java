package org.courtside.identity;

import java.util.UUID;

public interface MembershipHistory {

    /** Whether the account's person has a membership period that is not empty, past, running or still to come. */
    boolean everHeldMembership(UUID accountId);
}
