package org.courtside.access.internal;

import org.courtside.access.GrantInstruction;
import org.courtside.access.GrantOutcome;
import org.courtside.access.GrantReference;
import org.courtside.access.ProbeOutcome;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

abstract class LoxoneTestSupport {

    static final ZoneId CLUB = ZoneId.of("Europe/Berlin");
    static final Duration DEADLINE = Duration.ofSeconds(10);
    static final UUID COURT_ONE = UUID.fromString("00000000-0000-0000-0000-00000000c001");
    static final UUID COURT_TWO = UUID.fromString("00000000-0000-0000-0000-00000000c002");
    static final String CODE = "4826";

    final AdjustableClock clock = new AdjustableClock(Instant.parse("2026-11-02T09:00:00Z"));
    final Map<UUID, String> mapping = new ConcurrentHashMap<>();
    private final Map<UUID, String> codes = new ConcurrentHashMap<>();
    private final AtomicInteger nextCode = new AtomicInteger(Integer.parseInt(CODE));
    private final List<LoxoneAccessControl> opened = new CopyOnWriteArrayList<>();
    LoxoneSimulator simulator;
    LoxoneAccessControl connector;

    @BeforeEach
    void startSimulator() throws IOException {
        simulator = new LoxoneSimulator(clock, CLUB);
        mapping.put(COURT_ONE, simulator.groupUuid("Court 1"));
        mapping.put(COURT_TWO, simulator.groupUuid("Court 2"));
        connector = ready(connectorFor(simulator.settingsByUrl(DEADLINE)));
    }

    LoxoneAccessControl ready(LoxoneAccessControl probed) {
        assertThat(probed.probe()).as("the pass probes before its first call, which reads the normal groups")
                .isEqualTo(new ProbeOutcome.Answered());
        simulator.forgetRequests();
        return probed;
    }

    @AfterEach
    void stopSimulator() {
        opened.forEach(LoxoneAccessControl::close);
        assertThat(simulator.untouchedForeignUsersViolations())
                .as("no foreign, admin or member user may be changed or named by a mutating request")
                .isEmpty();
        simulator.close();
    }

    LoxoneAccessControl connectorFor(LoxoneSettings settings) {
        LoxoneAccessControl created = new LoxoneAccessControl(settings,
                accessPoint -> Optional.ofNullable(mapping.get(accessPoint)), LoxoneSimulator.clientTrust(), clock);
        opened.add(created);
        return created;
    }

    GrantInstruction instruction(UUID grantId) {
        return instruction(grantId, null, codeOf(grantId), Set.of(COURT_ONE));
    }

    String codeOf(UUID grantId) {
        return codes.computeIfAbsent(grantId, id -> String.valueOf(nextCode.getAndIncrement()));
    }

    GrantInstruction instruction(UUID grantId, @Nullable String externalReference, String code,
                                 Set<UUID> accessPoints) {
        Instant from = clock.instant().plus(Duration.ofHours(1));
        return new GrantInstruction(new GrantReference(grantId, externalReference), code, from,
                from.plus(Duration.ofHours(2)), accessPoints);
    }

    String installed(UUID grantId) {
        GrantOutcome outcome = connector.grant(instruction(grantId));
        assertThat(outcome).as("the grant must be installed before this test acts on it")
                .isInstanceOf(GrantOutcome.Accepted.class);
        return ((GrantOutcome.Accepted) outcome).externalReference();
    }
}
