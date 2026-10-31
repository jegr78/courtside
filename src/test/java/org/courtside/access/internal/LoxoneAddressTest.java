package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LoxoneAddressTest extends LoxoneTestSupport {

    private LoxoneAccessControl bySerial;

    @BeforeEach
    void connectBySerial() {
        bySerial = connectorFor(simulator.settingsBySerial(DEADLINE));
    }

    @Test
    void givenASerial_whenCallsFollow_thenTheAddressIsResolvedOnceAndCached() {
        // when
        GrantOutcome first = bySerial.grant(instruction(UUID.randomUUID()));
        GrantOutcome second = bySerial.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(first).isInstanceOf(GrantOutcome.Accepted.class);
        assertThat(second).isInstanceOf(GrantOutcome.Accepted.class);
        assertThat(simulator.count("getip")).isEqualTo(1);
    }

    @Test
    void givenARelayMove_whenTheOldHostRefusesConnections_thenTheAddressIsResolvedAgainAndTheCallSucceeds()
            throws IOException {
        // given
        bySerial.grant(instruction(UUID.randomUUID()));
        simulator.moveRelay();

        // when
        GrantOutcome outcome = bySerial.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(outcome).isInstanceOf(GrantOutcome.Accepted.class);
        assertThat(simulator.count("getip")).isEqualTo(2);
    }

    @Test
    void givenNoRelayForTheSerial_whenProbed_thenTheMiniserverIsUnreachable() {
        // given
        simulator.force("getip", 404);

        // when
        ProbeOutcome probed = bySerial.probe();

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Unreachable(
                "Loxone Cloud found no address for the Miniserver (getip 404)"));
    }

    @Test
    void givenAMiniserverWithoutARelayConnection_whenProbed_thenTheMiniserverIsUnreachable() {
        // given
        simulator.force("getip", 504);

        // when
        ProbeOutcome probed = bySerial.probe();

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Unreachable(
                "Loxone Cloud found no address for the Miniserver (getip 504)"));
    }

    @Test
    void givenAMiniserverWithoutARelayConnection_whenACallIsMade_thenItIsAnUnclearAnswer() {
        // given
        simulator.force("getip", 504);

        // when / then
        assertThatThrownBy(() -> bySerial.grant(instruction(UUID.randomUUID())))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("Loxone Cloud found no address for the Miniserver (getip 504)");
        assertThat(simulator.count("getuserlist2")).isZero();
    }
}
