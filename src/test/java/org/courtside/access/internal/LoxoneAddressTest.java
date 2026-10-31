package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.URI;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

class LoxoneAddressTest extends LoxoneTestSupport {

    private LoxoneAccessControl bySerial;

    @BeforeEach
    void connectBySerial() {
        bySerial = connectorFor(simulator.settingsBySerial(DEADLINE));
    }

    @Test
    void givenASerial_whenCallsFollow_thenTheAddressIsResolvedOnceAndCached() {
        // given
        bySerial.probe();

        // when
        GrantOutcome first = bySerial.grant(instruction(UUID.randomUUID()));
        GrantOutcome second = bySerial.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(first).isInstanceOf(GrantOutcome.Accepted.class);
        assertThat(second).isInstanceOf(GrantOutcome.Accepted.class);
        assertThat(simulator.count("getip")).isEqualTo(1);
    }

    @Test
    void givenARelayMove_whenTheOldHostRefusesConnections_thenTheNextCallResolvesTheAddressAgain()
            throws IOException {
        // given
        bySerial.probe();
        bySerial.grant(instruction(UUID.randomUUID()));
        simulator.moveRelay();

        // when
        Throwable failed = catchThrowable(() -> bySerial.grant(instruction(UUID.randomUUID())));
        GrantOutcome next = bySerial.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(failed).as("a failed call is not repeated inside itself").isInstanceOf(LoxoneFailure.class)
                .hasMessage("could not connect for getuserlist2");
        assertThat(next).isInstanceOf(GrantOutcome.Accepted.class);
        assertThat(simulator.count("getip")).isEqualTo(2);
    }

    @Test
    void givenARelayAnsweringAnErrorPage_whenACallFails_thenTheNextCallGoesToTheNewAddress() throws IOException {
        // given
        bySerial.probe();
        simulator.moveRelayLeavingAnErrorPage();

        // when
        Throwable failed = catchThrowable(() -> bySerial.grant(instruction(UUID.randomUUID())));
        long atTheBrokenRelay = simulator.countAtTheBrokenRelay();
        GrantOutcome next = bySerial.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(failed).isInstanceOf(LoxoneFailure.class).hasMessage("getuserlist2 answered 502");
        assertThat(next).as("the next call resolves the relay again").isInstanceOf(GrantOutcome.Accepted.class);
        assertThat(simulator.countAtTheBrokenRelay()).as("nothing more reaches the old relay")
                .isEqualTo(atTheBrokenRelay);
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
    void givenAMiniserverWithoutARelayConnection_whenACallIsMade_thenItIsAnUnclearAnswer() throws IOException {
        // given
        ready(bySerial);
        simulator.moveRelay();
        simulator.force("getip", 504);
        catchThrowable(() -> bySerial.grant(instruction(UUID.randomUUID())));

        // when / then
        assertThatThrownBy(() -> bySerial.grant(instruction(UUID.randomUUID())))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("Loxone Cloud found no address for the Miniserver (getip 504)");
        assertThat(simulator.count("getuserlist2")).isZero();
    }

    @Test
    void givenLoxonesRelays_whenAResolvedAddressIsChecked_thenOnlyHttpsHostsUnderARelayDomainInItsPortsAreAdmitted() {
        // given
        LoxoneAddress.Serial cloud = LoxoneAddress.Serial.throughLoxoneCloud(LoxoneSimulator.SERIAL);

        // then
        assertThat(cloud.admits(URI.create("https://eu-1.remcov3.loxonecloud.com:31234"))).isTrue();
        assertThat(cloud.admits(URI.create("https://192-168-1-47.504F94A0EE01.dyndns.loxonecloud.com:443")))
                .isTrue();
        assertThat(cloud.admits(URI.create("https://eu-1.remcov3.loxonecloud.com:49001")))
                .as("a remote connect relay listens on 20000 to 49000").isFalse();
        assertThat(cloud.admits(URI.create("https://eu-1.remcov3.loxonecloud.com")))
                .as("the default port 443 is outside the relay range").isFalse();
        assertThat(cloud.admits(URI.create("https://evilremcov3.loxonecloud.com:31234")))
                .as("the domain is bounded by a label").isFalse();
        assertThat(cloud.admits(URI.create("https://eu-1.remcov3.loxonecloud.com.example.org:31234"))).isFalse();
        assertThat(cloud.admits(URI.create("http://eu-1.remcov3.loxonecloud.com:31234"))).isFalse();
        assertThat(cloud.admits(URI.create("https://miniserver.example.org:31234"))).isFalse();
    }

    @Test
    void givenAResolverNamingAHostOutsideTheRelays_whenACallIsMade_thenNoRequestReachesThatHost() throws IOException {
        // given
        int relayPort = simulator.url().getPort();
        LoxoneAccessControl confined = connectorFor(simulator.settingsBySerial(DEADLINE,
                List.of(new LoxoneAddress.Relay("localhost", relayPort, relayPort))));
        try (LoxoneSimulator foreign = new LoxoneSimulator(clock, ZoneId.of("Europe/Berlin"))) {
            simulator.resolveTo(foreign.url());

            // when / then
            assertThatThrownBy(confined::probe)
                    .isInstanceOf(LoxoneFailure.class)
                    .hasMessage("getip answered an address outside Loxone's relays");
            assertThat(foreign.requests()).as("neither the login hash nor a token leaves for that host").isEmpty();
            assertThat(simulator.commands()).containsExactly("getip");
        }
    }
}
