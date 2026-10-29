package org.courtside.access.internal;

import org.courtside.access.AccessControlConnector;
import org.courtside.access.GrantInstruction;
import org.courtside.access.GrantOutcome;
import org.courtside.access.GrantReference;
import org.courtside.access.ProbeOutcome;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** An access-control system held in memory that accepts every grant; codes it hands out open nothing. */
class SimulatedAccessControl implements AccessControlConnector {

    static final String NAME = "simulated";

    private final Set<UUID> installed = ConcurrentHashMap.newKeySet();

    @Override
    public GrantOutcome grant(GrantInstruction instruction) {
        installed.add(instruction.reference().grantId());
        return new GrantOutcome.Accepted(externalReferenceOf(instruction.reference().grantId()));
    }

    @Override
    public GrantOutcome revoke(GrantReference reference) {
        installed.remove(reference.grantId());
        return new GrantOutcome.Accepted(externalReferenceOf(reference.grantId()));
    }

    @Override
    public ProbeOutcome probe() {
        return new ProbeOutcome.Answered();
    }

    @Override
    public String mappingOf(Set<UUID> accessPointIds) {
        return NAME;
    }

    boolean holds(UUID grantId) {
        return installed.contains(grantId);
    }

    private static String externalReferenceOf(UUID grantId) {
        return "simulated-" + grantId;
    }
}
