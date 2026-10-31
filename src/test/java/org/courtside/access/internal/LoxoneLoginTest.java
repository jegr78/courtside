package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.Scope;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LoxoneLoginTest extends LoxoneTestSupport {

    private static final String KEY =
            "34314135433345394432463030423737313845363443323941423544303346314538433637413230";
    private static final String SALT = "3f9a12c4be7d0516";

    @Test
    void givenASha256Key_whenTheLoginIsHashed_thenItMatchesTheDocumentedRecipeComputedByHand() {
        // when
        String hash = LoxoneLogin.hash(LoxoneSimulator.USER, LoxoneSimulator.PASSWORD, KEY, SALT, "SHA256");

        // then
        assertThat(hash).isEqualTo("feabb923a8e39a495316965a480f3659bbf1ed02059440b4b3efd18e4ae3a254");
    }

    @Test
    void givenASha1Key_whenTheLoginIsHashed_thenItMatchesTheDocumentedRecipeComputedByHand() {
        // when
        String hash = LoxoneLogin.hash(LoxoneSimulator.USER, LoxoneSimulator.PASSWORD, KEY, SALT, "SHA1");

        // then
        assertThat(hash).isEqualTo("54234c3dd05cc1850399ce341752b0038aa3be39");
    }

    @Test
    void givenASha1Miniserver_whenProbed_thenTheLoginSucceeds() {
        // given
        simulator.hashWith("SHA1");

        // when
        ProbeOutcome probed = connector.probe();

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Answered());
    }

    @Test
    void whenATokenIsAcquired_thenItAsksForAppAndUserManagementWithAStableClientUuid() {
        // when
        connector.probe();
        connectorFor(simulator.settingsByUrl(DEADLINE)).probe();

        // then
        assertThat(simulator.permissions()).as("permission 4 (app) plus 0x800 (user management)")
                .containsExactly(2052, 2052);
        assertThat(simulator.clientUuids()).hasSize(2).allMatch(uuid -> uuid.equals(simulator.clientUuids()
                .getFirst())).allMatch(uuid -> uuid.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{16}"));
        assertThat(LoxoneLogin.clientUuid(new LoxoneAddress.Fixed(URI.create("https://other.example.org"))))
                .as("another address is another client")
                .isNotEqualTo(simulator.clientUuids().getFirst())
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{16}");
    }

    @Test
    void givenAValidToken_whenCallsFollow_thenItIsReusedUntilAnHourBeforeItsEnd() {
        // given
        simulator.issueTokensFor(Duration.ofDays(20));
        installed(UUID.randomUUID());
        installed(UUID.randomUUID());
        long acquiredOnce = simulator.count("getjwt");

        // when
        clock.advance(Duration.ofDays(20).minusMinutes(30));
        installed(UUID.randomUUID());

        // then
        assertThat(acquiredOnce).as("two calls share one token").isEqualTo(1);
        assertThat(simulator.count("getjwt")).as("a token within an hour of its end is replaced").isEqualTo(2);
    }

    @Test
    void givenAnExpiredToken_whenACallIsMade_thenTheTokenIsAcquiredOnceMoreAndTheCallSucceeds() {
        // given
        installed(UUID.randomUUID());
        simulator.expireTokens();

        // when
        GrantOutcome outcome = connector.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(outcome).isInstanceOf(GrantOutcome.Accepted.class);
        assertThat(simulator.count("getjwt")).isEqualTo(2);
    }

    @Test
    void givenAMiniserverRefusingEveryToken_whenACallIsMade_thenTheConnectorIsRefusedAfterOneRenewal() {
        // given
        simulator.refuseEveryToken();

        // when
        GrantOutcome outcome = connector.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Refused(Scope.CONNECTOR,
                "Miniserver refused the token for getuserlist2 (401)"));
        assertThat(simulator.count("getjwt")).as("one renewal inside the call, not more").isEqualTo(2);
        assertThat(simulator.count("getuserlist2")).isEqualTo(2);
    }

    @Test
    void givenAWrongPassword_whenACallIsMade_thenTheConnectorIsRefused() {
        // given
        LoxoneSettings settings = simulator.settingsByUrl(DEADLINE);
        LoxoneAccessControl wrong = connectorFor(new LoxoneSettings(settings.address(), settings.user(),
                "wrong-example-password", settings.zone(), settings.callDeadline()));

        // when
        GrantOutcome outcome = wrong.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Refused(Scope.CONNECTOR,
                "Miniserver refused the login of the technical user (getjwt 401)"));
        assertThat(simulator.count("getuserlist2")).isZero();
    }

    @Test
    void givenATokenWithoutUserManagement_whenProbed_thenTheProbeIsRefusedBeforeAnyUserRequest() {
        // given
        simulator.withholdUserManagement();

        // when
        ProbeOutcome probed = connector.probe();
        GrantOutcome granted = connector.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Refused("token lacks the user-management right"));
        assertThat(granted).isEqualTo(new GrantOutcome.Refused(Scope.CONNECTOR,
                "token lacks the user-management right"));
        assertThat(simulator.count("getuserlist2")).as("a request without the right counts towards the lock")
                .isZero();
    }

    @Test
    void givenAMiniserverDenyingTheRight_whenACallIsMade_thenTheConnectorIsRefused() {
        // given
        simulator.force("getuserlist2", 403);

        // when
        GrantOutcome outcome = connector.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Refused(Scope.CONNECTOR,
                "Miniserver denied getuserlist2 (403)"));
    }

    @Test
    void givenADisabledTechnicalUser_whenACallIsMade_thenTheConnectorIsRefused() {
        // given
        simulator.force("getjwt", 423);

        // when
        GrantOutcome outcome = connector.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(outcome).isEqualTo(new GrantOutcome.Refused(Scope.CONNECTOR,
                "Miniserver disabled the technical user (getjwt 423)"));
    }

    @Test
    void givenALockedMiniserver_whenCallsFollow_thenNothingIsSentUntilTheLockEnds() {
        // given
        installed(UUID.randomUUID());
        simulator.force("getuserlist2", 429);
        GrantOutcome locked = connector.grant(instruction(UUID.randomUUID()));
        simulator.forgetRequests();

        // when
        GrantOutcome during = connector.grant(instruction(UUID.randomUUID()));
        ProbeOutcome probedDuring = connector.probe();
        simulator.release("getuserlist2");
        clock.advance(Duration.ofMinutes(5));
        GrantOutcome after = connector.grant(instruction(UUID.randomUUID()));

        // then
        GrantOutcome.RetryLater expected = new GrantOutcome.RetryLater(Scope.CONNECTOR,
                clock.instant(), "Miniserver lock after requests without rights");
        assertThat(locked).isEqualTo(expected);
        assertThat(during).isEqualTo(expected);
        assertThat(probedDuring).isEqualTo(new ProbeOutcome.Refused("Miniserver lock after requests without rights"));
        assertThat(after).isInstanceOf(GrantOutcome.Accepted.class);
        assertThat(simulator.commands()).as("only the call after the lock reaches the Miniserver")
                .containsExactly("getuserlist2", "addoredituser", "updateuseraccesscode");
    }

    @Test
    void givenAnAcquiredToken_whenTheConnectorCloses_thenTheTokenIsKilled() {
        // given
        installed(UUID.randomUUID());
        assertThat(simulator.issuedTokens()).hasSize(1);

        // when
        connector.close();

        // then
        assertThat(simulator.count("killtoken")).isEqualTo(1);
        assertThat(simulator.issuedTokens()).as("the Miniserver holds no token of this instance any more").isEmpty();
    }
}
