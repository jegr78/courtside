package org.courtside.access.internal;

import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.Scope;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
    void givenAnUnknownAlgorithmOrAMalformedKey_whenTheLoginIsHashed_thenNoHashIsMade() {
        // when / then
        assertThatThrownBy(() -> LoxoneLogin.hash(LoxoneSimulator.USER, LoxoneSimulator.PASSWORD, KEY, SALT, "MD5"))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("getkey2 named a hash algorithm the connector does not know");
        assertThatThrownBy(() -> LoxoneLogin.hash(LoxoneSimulator.USER, LoxoneSimulator.PASSWORD, "zz", SALT, "SHA256"))
                .isInstanceOf(LoxoneFailure.class)
                .hasMessage("getkey2 answered a key that is not hex");
    }

    @Test
    void givenAKeyAnswerWithoutACodeOrASalt_whenProbed_thenTheMissingFieldIsNamed() {
        // given
        simulator.forgetRequests();
        simulator.answerRaw("getkey2", "{\"LL\":{\"control\":\"getkey2\",\"value\":{\"key\":\"00\"}}}");

        // when / then
        assertThatThrownBy(connectorFor(simulator.settingsByUrl(DEADLINE))::probe).isInstanceOf(LoxoneFailure.class)
                .hasMessage("getkey2 answered without salt");
        assertThat(simulator.count("getjwt")).isZero();
    }

    @Test
    void givenAKeyAnswerWhoseValueIsBrokenJson_whenProbed_thenTheMissingKeyIsNamed() {
        // given
        simulator.forgetRequests();
        simulator.answerRaw("getkey2", "{\"LL\":{\"control\":\"getkey2\",\"value\":\"{key\",\"code\":200}}");

        // when / then
        assertThatThrownBy(connectorFor(simulator.settingsByUrl(DEADLINE))::probe).isInstanceOf(LoxoneFailure.class)
                .hasMessage("getkey2 answered without key");
    }

    @Test
    void givenAnUndocumentedLoginCode_whenProbed_thenTheCodeIsNamed() {
        // given
        simulator.forgetRequests();
        simulator.answerRaw("getkey2", "{\"LL\":{\"control\":\"getkey2\",\"value\":\"\",\"Code\":\"500\"}}");

        // when / then
        assertThatThrownBy(connectorFor(simulator.settingsByUrl(DEADLINE))::probe).isInstanceOf(LoxoneFailure.class)
                .hasMessage("getkey2 answered 500");
    }

    @Test
    void givenATokenAnswerWithoutALifespan_whenProbed_thenNoTokenIsKept() {
        // given
        simulator.forgetRequests();
        simulator.answerRaw("getjwt", "{\"LL\":{\"control\":\"getjwt\",\"value\":{\"token\":\"eyJx\"},"
                + "\"Code\":\"200\"}}");

        // when / then
        assertThatThrownBy(connectorFor(simulator.settingsByUrl(DEADLINE))::probe).isInstanceOf(LoxoneFailure.class)
                .hasMessage("getjwt answered without a lifespan or rights");
        assertThat(simulator.count("getuserlist2")).isZero();
    }

    @Test
    void whenTheSettingsArePrinted_thenThePasswordIsLeftOut() {
        // when
        String printed = simulator.settingsByUrl(DEADLINE).toString();

        // then
        assertThat(printed).contains(LoxoneSimulator.USER).doesNotContain(LoxoneSimulator.PASSWORD);
    }

    @Test
    void givenAClosedConnector_whenProbed_thenNoRequestLeaves() {
        // given
        LoxoneAccessControl closed = connectorFor(simulator.settingsByUrl(DEADLINE));
        closed.close();
        simulator.forgetRequests();

        // when / then
        assertThatThrownBy(closed::probe).isInstanceOf(LoxoneFailure.class).hasMessage("the connector is closed");
        assertThat(simulator.requests()).isEmpty();
    }

    @Test
    void givenASha1Miniserver_whenProbed_thenTheLoginSucceeds() {
        // given
        simulator.hashWith("SHA1");

        // when
        ProbeOutcome probed = connectorFor(simulator.settingsByUrl(DEADLINE)).probe();

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Answered());
        assertThat(simulator.count("getjwt")).isEqualTo(1);
    }

    @Test
    void whenATokenIsAcquired_thenItAsksForAppChangeCodesAndUserManagementWithAStableClientUuid() {
        // when
        connector.probe();
        connectorFor(simulator.settingsByUrl(DEADLINE)).probe();

        // then
        assertThat(simulator.permissions())
                .as("permission 4 (app), 0x20 (change codes) and 0x800 (user management)")
                .containsExactly(2084, 2084);
        assertThat(simulator.clientUuids()).hasSize(2).allMatch(uuid -> uuid.equals(simulator.clientUuids()
                .getFirst())).allMatch(uuid -> uuid.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{16}"));
        assertThat(LoxoneLogin.clientUuid(new LoxoneAddress.Fixed(URI.create("https://other.example.org")), ""))
                .as("another address is another client")
                .isNotEqualTo(simulator.clientUuids().getFirst())
                .matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{16}");
    }

    @Test
    void givenTwoInstancesOfOneMiniserver_whenEachAcquiresATokenTwice_thenEachKeepsItsOwnClientUuid() {
        // given
        LoxoneSettings url = simulator.settingsByUrl(DEADLINE);
        LoxoneSettings production = new LoxoneSettings(url.address(), url.user(), url.password(), DEADLINE,
                "https://courts.example.org");
        LoxoneSettings trial = new LoxoneSettings(url.address(), url.user(), url.password(), DEADLINE,
                "https://courts.example.org:10000");

        int before = simulator.clientUuids().size();

        // when
        connectorFor(production).probe();
        connectorFor(production).probe();
        connectorFor(trial).probe();

        // then
        List<String> uuids = simulator.clientUuids().subList(before, before + 3);
        assertThat(uuids.get(1)).as("one instance asks under the same client uuid after a restart")
                .isEqualTo(uuids.getFirst());
        assertThat(uuids.get(2)).as("a second instance on the same Miniserver is another client")
                .isNotEqualTo(uuids.getFirst());
        assertThat(LoxoneLogin.clientUuid("courtside-device-contract", url.address()))
                .as("the device run keeps its own namespace").isNotIn(uuids);
    }

    @Test
    void givenAValidToken_whenCallsFollow_thenItIsReusedUntilAnHourBeforeItsEnd() {
        // given
        installed(UUID.randomUUID());
        installed(UUID.randomUUID());
        long acquiredAgain = simulator.count("getjwt");

        // when
        clock.advance(Duration.ofDays(20).minusMinutes(30));
        installed(UUID.randomUUID());

        // then
        assertThat(acquiredAgain).as("both calls use the token the probe acquired").isZero();
        assertThat(simulator.count("getjwt")).as("a token within an hour of its end is replaced").isEqualTo(1);
    }

    @Test
    void givenATokenDueForRenewal_whenTheNextCallRenewsIt_thenTheOldTokenIsKilledWithItself() {
        // given
        installed(UUID.randomUUID());
        Set<String> before = simulator.issuedTokens();
        clock.advance(Duration.ofDays(20).minusMinutes(30));

        // when
        installed(UUID.randomUUID());

        // then
        assertThat(simulator.count("killtoken")).as("renewal kills the token it replaces").isEqualTo(1);
        assertThat(simulator.issuedTokens()).as("only the renewed token stays on the Miniserver").hasSize(1)
                .doesNotContainAnyElementsOf(before);
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
        assertThat(simulator.count("getjwt")).isEqualTo(1);
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
        assertThat(simulator.count("getjwt")).as("one renewal inside the call, not more").isEqualTo(1);
        assertThat(simulator.count("getuserlist2")).isEqualTo(2);
    }

    @Test
    void givenAWrongPassword_whenProbed_thenTheConnectorIsRefused() {
        // given
        LoxoneSettings settings = simulator.settingsByUrl(DEADLINE);
        LoxoneAccessControl wrong = connectorFor(new LoxoneSettings(settings.address(), settings.user(),
                "wrong-example-password", settings.callDeadline()));

        // when
        ProbeOutcome probed = wrong.probe();

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Refused(
                "Miniserver refused the login of the technical user (getjwt 401)"));
        assertThat(simulator.count("getuserlist2")).isZero();
    }

    @Test
    void givenAGroupWithoutTheWebsiteRight_whenProbed_thenTheRefusalNamesTheMissingRight() {
        // given
        simulator.answerRaw("getjwt", "{\"LL\":{\"control\":\"getjwt\",\"value\":\"\",\"Code\":\"412\"}}");

        // when
        ProbeOutcome probed = connectorFor(simulator.settingsByUrl(DEADLINE)).probe();

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Refused(
                "Miniserver refused a token for the technical user (getjwt 412)"));
    }

    @Test
    void givenA412BeforeTheToken_whenProbed_thenNoRightIsBlamedAndTheCodeIsNamed() {
        // given
        simulator.answerRaw("getkey2", "{\"LL\":{\"control\":\"getkey2\",\"value\":\"\",\"Code\":\"412\"}}");

        // when / then
        assertThatThrownBy(connectorFor(simulator.settingsByUrl(DEADLINE))::probe).isInstanceOf(LoxoneFailure.class)
                .hasMessage("getkey2 answered 412");
    }

    @Test
    void givenATokenWithoutUserManagement_whenProbedOrRenewed_thenItIsRefusedBeforeAnyRequestNeedingTheRight() {
        // given
        simulator.withholdUserManagement();

        // when
        ProbeOutcome probed = connectorFor(simulator.settingsByUrl(DEADLINE)).probe();
        simulator.expireTokens();
        GrantOutcome granted = connector.grant(instruction(UUID.randomUUID()));

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Refused("token lacks the user-management or code-change right"));
        assertThat(granted).isEqualTo(new GrantOutcome.Refused(Scope.CONNECTOR,
                "token lacks the user-management or code-change right"));
        assertThat(simulator.refusalsForMissingRights()).as("a request without the right counts towards the lock")
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
    void givenADisabledTechnicalUser_whenProbed_thenTheConnectorIsRefused() {
        // given
        simulator.force("getjwt", 423);

        // when
        ProbeOutcome probed = connectorFor(simulator.settingsByUrl(DEADLINE)).probe();

        // then
        assertThat(probed).isEqualTo(new ProbeOutcome.Refused("Miniserver disabled the technical user (getjwt 423)"));
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
