package org.courtside.access;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * An access-control system holding one remote user per grant, named from the grant id with {@code [a-z0-9_]}.
 * Each call ends within its configured deadline across all its requests and stops when interrupted; an exception
 * or a missed deadline is an unclear answer, which the caller counts as applied. Every reason a connector returns
 * is fixed, operator-readable text and never carries a URL, a credential or a code; a board reads it.
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

    /** A fingerprint of at most 200 characters for how these points map onto the system; read locally, never a call. */
    String mappingOf(Set<UUID> accessPointIds);

    /** Whether a board maps access points onto groups of this system at all. */
    default boolean listsGroups() {
        return false;
    }

    /** The groups a board may map an access point onto, as the last successful probe read them; read locally. */
    default List<RemoteGroup> groups() {
        return List.of();
    }

    /** The grant ids of every remote user this system lists; empty when the system cannot list them. */
    default Optional<Set<UUID>> remoteGrantIds() {
        return Optional.empty();
    }
}
