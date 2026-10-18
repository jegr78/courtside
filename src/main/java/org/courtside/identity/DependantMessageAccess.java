package org.courtside.identity;

import java.util.UUID;

/** Lets a module that cannot see the relationship ask whether the signed-in guardian may read a dependant's messages. */
public interface DependantMessageAccess {

    UserAccount requireReadableAccount(UUID dependantPersonId);
}
