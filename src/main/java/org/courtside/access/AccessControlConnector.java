package org.courtside.access;

import java.util.Set;
import java.util.UUID;

/**
 * An access-control system holding one remote user per grant, named from the grant id with {@code [a-z0-9_]}.
 * Each call ends within its configured deadline across all its requests and stops when interrupted; an exception
 * or a missed deadline is an unclear answer, which the caller counts as applied.
 */
public interface AccessControlConnector {

    /** Upserts the grant's one remote user with window, code and complete access point list; idempotent. */
    GrantOutcome grant(GrantInstruction instruction);

    /** The same upsert as {@link #grant}, for a grant the system has already accepted. */
    default GrantOutcome reschedule(GrantInstruction instruction) {
        return grant(instruction);
    }

    /** Removes every remote user of the grant; answers {@code Accepted} for none only after a complete listing. */
    GrantOutcome revoke(GrantReference reference);

    /** Checks reachability, authentication and the right to manage users. */
    ProbeOutcome probe();

    /** A fingerprint of how these access points map onto the system, read from local configuration, never a call. */
    String mappingOf(Set<UUID> accessPointIds);
}
