package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;

import java.lang.reflect.Field;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

final class Grants {

    static final Instant NOW = Instant.parse("2026-05-12T08:00:00Z");
    static final UUID NORTH_GATE = UUID.fromString("70300000-0000-0000-0000-000000000001");
    static final UUID SOUTH_GATE = UUID.fromString("70300000-0000-0000-0000-000000000002");
    static final Demand DEMAND = new Demand(Instant.parse("2026-05-12T09:45:00Z"),
            Instant.parse("2026-05-12T11:15:00Z"), Set.of(NORTH_GATE));
    static final String MAPPING = "north-group";
    static final String CODE = "482915";
    static final Duration DEADLINE = Duration.ofSeconds(15);
    static final ProbeOutcome PROBE_ANSWERS = new ProbeOutcome.Answered();
    static final ProbeOutcome PROBE_FAILS = new ProbeOutcome.Unreachable("connection refused");

    private Grants() {
    }

    static AccessGrant fresh() {
        AccessGrant grant = new AccessGrant();
        set(grant, "id", UUID.randomUUID());
        set(grant, "bookingId", UUID.randomUUID());
        set(grant, "remote", RemoteState.NONE);
        set(grant, "nextAttemptAt", NOW);
        return grant;
    }

    private static void set(AccessGrant grant, String field, Object value) {
        try {
            Field declared = AccessGrant.class.getDeclaredField(field);
            declared.setAccessible(true);
            declared.set(grant, value);
        } catch (ReflectiveOperationException missing) {
            throw new IllegalStateException("A fresh grant row has the field " + field, missing);
        }
    }

    static CallResult answered(GrantOutcome outcome) {
        return new CallResult.Answered(outcome);
    }

    static CallResult unclear() {
        return new CallResult.Unclear();
    }

    static SentCall decideAndBegin(AccessGrant grant, Demand demand, String mapping, Instant at) {
        Action action = grant.decide(demand, mapping, at);
        return grant.beginCall(action, CODE, at);
    }

    static AccessGrant installed() {
        AccessGrant grant = fresh();
        SentCall call = decideAndBegin(grant, DEMAND, MAPPING, NOW);
        grant.record(call, answered(new GrantOutcome.Accepted("remote-user-1")), null, NOW, DEADLINE);
        return grant;
    }
}
