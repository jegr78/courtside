package org.courtside.identity;

import java.util.UUID;

public interface MembershipStanding {

    boolean holdsRunningMembership(UUID accountId);
}
