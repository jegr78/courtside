package org.courtside.identity;

import java.util.UUID;

public interface MembershipHistory {

    /** Whether the account's person has any membership period, past, running or still to come. */
    boolean everHeldMembership(UUID accountId);
}
