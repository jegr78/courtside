package org.courtside.access.internal;

import org.courtside.access.AccessControlConnector;
import org.courtside.access.GrantInstruction;
import org.courtside.access.GrantOutcome;
import org.courtside.access.GrantReference;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.Scope;

import javax.net.ssl.SSLContext;
import java.time.Clock;
import java.util.Set;
import java.util.UUID;

class LoxoneAccessControl implements AccessControlConnector, AutoCloseable {

    LoxoneAccessControl(LoxoneSettings settings, LoxoneGroupMapping mapping, SSLContext ssl, Clock clock) {
    }

    @Override
    public GrantOutcome grant(GrantInstruction instruction) {
        return new GrantOutcome.Refused(Scope.CONNECTOR, "not implemented");
    }

    @Override
    public GrantOutcome revoke(GrantReference reference) {
        return new GrantOutcome.Refused(Scope.CONNECTOR, "not implemented");
    }

    @Override
    public ProbeOutcome probe() {
        return new ProbeOutcome.Refused("not implemented");
    }

    @Override
    public String mappingOf(Set<UUID> accessPointIds) {
        return "";
    }

    @Override
    public void close() {
    }
}
