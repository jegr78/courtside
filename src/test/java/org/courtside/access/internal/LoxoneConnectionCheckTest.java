package org.courtside.access.internal;

import org.courtside.access.CheckOutcome;
import org.courtside.access.CheckResult;
import org.courtside.access.RemoteGroup;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.net.ssl.SSLContext;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LoxoneConnectionCheckTest extends LoxoneTestSupport {

    private static final String LEFTOVER = "courtside_probe_0123456789abcdef";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Map<UUID, String> granted = Map.of(COURT_ONE, "North gate", COURT_TWO, "South gate");

    @Test
    void givenAHealthyMiniserver_whenChecked_thenFiveChecksReportInOrderWithTheKeypadManual() {
        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(checked).extracting(ConnectionCheckRun.Checked::check)
                .containsExactly("miniserver", "login", "groups", "probe-user", "keypad");
        assertThat(checked).extracting(entry -> entry.result().outcome()).containsExactly(CheckOutcome.PASSED,
                CheckOutcome.PASSED, CheckOutcome.PASSED, CheckOutcome.PASSED, CheckOutcome.MANUAL);
        assertThat(result(checked, "miniserver")).isEqualTo(CheckResult.passed("access.check.miniserver.reached",
                Map.of("version", "14.2.5.16", "minimum", "14.2.5.16")));
        assertThat(simulator.count("apiKey")).as("address and version come from one apiKey call").isEqualTo(1);
        assertThat(result(checked, "login")).isEqualTo(CheckResult.passed("access.check.login.accepted", Map.of()));
        assertThat(result(checked, "groups")).isEqualTo(CheckResult.passed("access.check.groups.mapped",
                Map.of("accessPoints", "North gate, South gate")));
        assertThat(result(checked, "probe-user")).isEqualTo(CheckResult.passed("access.check.probeUser.passed",
                Map.of()));
        assertThat(result(checked, "keypad")).isEqualTo(CheckResult.manual("access.check.keypad.manual"));
    }

    @Test
    void givenASerial_whenTheAddressIsChecked_thenTheCloudIsAskedAfreshAndTheMiniserverReached() {
        // given
        LoxoneAccessControl bySerial = ready(connectorFor(simulator.settingsBySerial(DEADLINE)));

        // when
        List<ConnectionCheckRun.Checked> checked = checked(bySerial);

        // then
        assertThat(result(checked, "miniserver").outcome()).isEqualTo(CheckOutcome.PASSED);
        assertThat(simulator.count("getip")).as("the cached relay is forgotten so getip really runs").isEqualTo(1);
    }

    @Test
    void givenASerialTheCloudKnowsNoRelayFor_whenChecked_thenTheAddressFailsAsUnresolved() {
        // given
        LoxoneAccessControl bySerial = ready(connectorFor(simulator.settingsBySerial(DEADLINE)));
        simulator.force("getip", 404);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(bySerial);

        // then
        assertThat(result(checked, "miniserver")).isEqualTo(CheckResult.failed("access.check.address.unresolved",
                Map.of("status", "404")));
    }

    @Test
    void givenAResolverNamingAHostOutsideTheRelays_whenChecked_thenTheAddressFailsAndTheHostIsNeverAsked() {
        // given
        LoxoneAccessControl bySerial = connectorFor(simulator.settingsBySerial(DEADLINE,
                List.of(new LoxoneAddress.Relay("dyndns.loxonecloud.com", 1, 65_535))));

        // when
        List<ConnectionCheckRun.Checked> checked = checked(bySerial);

        // then
        assertThat(result(checked, "miniserver")).isEqualTo(CheckResult.failed("access.check.address.outsideRelays",
                Map.of()));
        assertThat(simulator.requests()).as("nothing reaches a host outside the relays")
                .allSatisfy(request -> assertThat(request.server()).isEqualTo("cloud"));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void givenATrustStoreWithoutTheMiniserversCertificate_whenChecked_thenTheAddressFailsAsCertificateRefused(
            boolean bySerial) throws NoSuchAlgorithmException {
        // given
        LoxoneSettings settings = bySerial ? simulator.settingsBySerial(DEADLINE) : simulator.settingsByUrl(DEADLINE);
        try (LoxoneAccessControl untrusting = new LoxoneAccessControl(settings,
                accessPoint -> Optional.ofNullable(mapping.get(accessPoint)), SSLContext.getDefault(), clock)) {

            // when
            List<ConnectionCheckRun.Checked> checked = checked(untrusting);

            // then
            assertThat(result(checked, "miniserver")).as("TLS verification refuses the certificate on either path")
                    .isEqualTo(CheckResult.failed("access.check.certificateRefused", Map.of()));
        }
    }

    @Test
    void givenARelayAnsweringAnErrorPage_whenChecked_thenTheAddressFailsAsNoMiniserver() {
        // given
        simulator.answerBare("apiKey", 502);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "miniserver")).isEqualTo(CheckResult.failed("access.check.address.noMiniserver",
                Map.of("status", "502")));
    }

    @ParameterizedTest
    @CsvSource({"14.2.5.9, FAILED, access.check.version.tooOld", "14.10.0.1, PASSED, access.check.miniserver.reached",
            "13.9.9.99, FAILED, access.check.version.tooOld", "15.0, PASSED, access.check.miniserver.reached"})
    void givenAMiniserverVersion_whenChecked_thenItIsComparedNumericallyWithTheMinimum(String version,
                                                                                       CheckOutcome outcome,
                                                                                       String code) {
        // given
        simulator.version(version);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "miniserver")).isEqualTo(new CheckResult(outcome, code,
                Map.of("version", version, "minimum", "14.2.5.16")));
    }

    @Test
    void givenAnApiKeyAnswerWithoutAVersion_whenChecked_thenTheVersionIsUnreadable() {
        // given
        simulator.answerRaw("apiKey", "{\"LL\":{\"control\":\"dev/cfg/apiKey\",\"value\":\"{'snr':'"
                + "50:4F:94:A0:EE:01'}\",\"Code\":\"200\"}}");

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "miniserver")).isEqualTo(CheckResult.failed("access.check.version.unreadable",
                Map.of()));
    }

    @Test
    void givenACachedToken_whenTheLoginIsChecked_thenTheTokenIsKilledAndTheLoginRunsAgain() {
        // given
        Set<String> cached = simulator.issuedTokens();

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "login")).isEqualTo(CheckResult.passed("access.check.login.accepted", Map.of()));
        assertThat(simulator.count("getkey2")).as("getkey2 really runs").isEqualTo(1);
        assertThat(simulator.issuedTokens()).as("the dropped token is killed").doesNotContainAnyElementsOf(cached);
    }

    @Test
    void givenAWrongPassword_whenChecked_thenTheLoginIsRefusedAndTheChecksNeedingItAreSkipped() {
        // given
        LoxoneSettings right = simulator.settingsByUrl(DEADLINE);
        LoxoneAccessControl wrong = connectorFor(new LoxoneSettings(right.address(), right.user(),
                "not-the-password", right.zone(), DEADLINE));

        // when
        List<ConnectionCheckRun.Checked> checked = checked(wrong);

        // then
        assertThat(result(checked, "login")).isEqualTo(CheckResult.failed("access.check.login.refused", Map.of()));
        assertThat(result(checked, "groups")).as("no login, no groups")
                .isEqualTo(CheckResult.skipped("access.check.skipped", Map.of("requires", "login")));
        assertThat(result(checked, "probe-user")).as("no login, no probe user")
                .isEqualTo(CheckResult.skipped("access.check.skipped", Map.of("requires", "login")));
        assertThat(result(checked, "miniserver").outcome()).as("checks without a login still run")
                .isEqualTo(CheckOutcome.PASSED);
        assertThat(simulator.commands()).doesNotContain("addoredituser", "getgrouplist");
    }

    @Test
    void givenATokenWithoutUserManagement_whenChecked_thenTheLoginFailsOnTheMissingRight() {
        // given
        simulator.withholdUserManagement();

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "login")).isEqualTo(CheckResult.failed("access.check.login.missingRight",
                Map.of()));
        assertThat(result(checked, "groups").outcome()).isEqualTo(CheckOutcome.SKIPPED);
    }

    @Test
    void givenATokenWithoutTheRightToChangeCodes_whenChecked_thenTheLoginFailsOnTheMissingRight() {
        // given
        simulator.withholdChangePassword();

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "login")).isEqualTo(CheckResult.failed("access.check.login.missingRight",
                Map.of()));
    }

    @Test
    void givenALockedMiniserver_whenChecked_thenTheLoginFailsOnTheLock() {
        // given
        simulator.force("getkey2", 429);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "login")).isEqualTo(CheckResult.failed("access.check.login.locked", Map.of()));
    }

    @Test
    void givenADisabledTechnicalUser_whenChecked_thenTheLoginFailsWithTheMiniserversReason() {
        // given
        simulator.force("getkey2", 423);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "login")).isEqualTo(CheckResult.failed("access.check.refused",
                Map.of("reason", "Miniserver disabled the technical user (getkey2 423)")));
    }

    @Test
    void givenAnAccessPointWithoutAGroup_whenChecked_thenTheGroupsFailNamingIt() {
        // given
        mapping.remove(COURT_TWO);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "groups")).isEqualTo(CheckResult.failed("access.check.groups.unmapped",
                Map.of("accessPoints", "South gate")));
    }

    @Test
    void givenAMappedGroupTheMiniserverNoLongerHas_whenChecked_thenTheGroupsFailNamingTheAccessPointAndReload() {
        // given
        simulator.removeGroup("Court 2");

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "groups")).isEqualTo(CheckResult.failed("access.check.groups.missing",
                Map.of("accessPoints", "South gate")));
        assertThat(connector.groups()).extracting(RemoteGroup::name).as("the check reloads the groups")
                .doesNotContain("Court 2").contains("Court 1");
    }

    @Test
    void givenNoAccessPointReceivingGrants_whenChecked_thenTheGroupsNeedNothing() {
        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector, Map.of(), DEADLINE);

        // then
        assertThat(result(checked, "groups")).isEqualTo(CheckResult.passed("access.check.groups.noneNeeded",
                Map.of()));
    }

    @Test
    void givenALeftoverProbeUser_whenChecked_thenItIsRemovedFirstAndTheNewOneHasNoGroupNoCodeAndTwoMinutes() {
        // given
        simulator.addUser(LEFTOVER, null);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "probe-user").outcome()).isEqualTo(CheckOutcome.PASSED);
        List<LoxoneSimulator.Request> probing = simulator.requests().stream()
                .filter(request -> List.of("getuserlist2", "addoredituser", "getuser", "deleteuser",
                        "updateuseraccesscode").contains(request.command())).toList();
        assertThat(probing).extracting(LoxoneSimulator.Request::command).as("leftover first, read back, delete, list")
                .containsExactly("getuserlist2", "deleteuser", "addoredituser", "getuser", "deleteuser",
                        "getuserlist2");
        JsonNode created = JSON.readTree(probing.get(2).arguments().getFirst());
        assertThat(created.path("name").asString()).matches("courtside_probe_[0-9a-f]{16}").isNotEqualTo(LEFTOVER);
        assertThat(created.path("userState").asInt()).as("a timespan user").isEqualTo(4);
        assertThat(created.path("expirationAction").asInt()).as("it deletes itself").isEqualTo(1);
        assertThat(created.path("validFrom").asLong()).isEqualTo(simulator.loxoneSeconds(clock.instant()));
        assertThat(created.path("validUntil").asLong())
                .isEqualTo(simulator.loxoneSeconds(clock.instant().plus(Duration.ofMinutes(2))));
        assertThat(created.path("usergroups").isArray() && created.path("usergroups").isEmpty())
                .as("no group").isTrue();
        assertThat(simulator.usersNamed(LEFTOVER)).isEmpty();
        assertThat(simulator.usersNamed(created.path("name").asString())).isEmpty();
    }

    @Test
    void givenAnAdminNamedLikeAProbeUser_whenChecked_thenTheProbeUserFailsAndNothingIsChanged() {
        // given
        simulator.addUser(LEFTOVER, "0f1e2d3c-4b5a-6978-8796a5b4c3d2e1f0", true);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "probe-user")).isEqualTo(CheckResult.failed(
                "access.check.probeUser.leftoverProtected", Map.of()));
        assertThat(simulator.requests()).noneMatch(LoxoneSimulator.Request::mutating);
    }

    @Test
    void givenAMiniserverRefusingTheProbeUser_whenChecked_thenItFailsAsNotCreated() {
        // given
        simulator.force("addoredituser", 500);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "probe-user")).isEqualTo(CheckResult.failed("access.check.probeUser.notCreated",
                Map.of("status", "500")));
    }

    @Test
    void givenAReadBackWithoutTheExpirationAction_whenChecked_thenItFailsNamingTheFieldAndTheUserIsStillDeleted() {
        // given
        simulator.omitOnReadBack("expirationAction");

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "probe-user")).isEqualTo(CheckResult.failed("access.check.probeUser.readBack",
                Map.of("field", "expirationAction")));
        assertThat(probeUsers()).as("a mismatch still deletes the probe user").isEmpty();
    }

    @Test
    void givenAProbeUserTheMiniserverCannotReadBack_whenChecked_thenItFailsNamingTheUserAndIsStillDeleted() {
        // given
        simulator.force("getuser", 500);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "probe-user")).isEqualTo(CheckResult.failed("access.check.probeUser.readBack",
                Map.of("field", "user")));
        assertThat(probeUsers()).isEmpty();
    }

    @Test
    void givenAFailingDelete_whenChecked_thenItFailsAndTheProbeUserExpiresOnItsOwnWithinTwoMinutes() {
        // given
        simulator.force("deleteuser", 500);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "probe-user")).isEqualTo(CheckResult.failed("access.check.probeUser.notDeleted",
                Map.of("status", "500")));
        assertThat(probeUsers()).singleElement().satisfies(left -> {
            assertThat(left.expirationAction).as("the Miniserver deletes it at its end").isEqualTo(1);
            assertThat(left.validUntil).isEqualTo(simulator.loxoneSeconds(clock.instant().plus(Duration.ofMinutes(2))));
            assertThat(left.groups).isEmpty();
            assertThat(left.code).isNull();
        });
    }

    @Test
    void givenADeleteTheMiniserverDidNotApply_whenChecked_thenTheProbeUserFailsAsStillListed() {
        // given
        simulator.ignoreDeletes();

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "probe-user")).isEqualTo(CheckResult.failed("access.check.probeUser.stillListed",
                Map.of()));
    }

    @Test
    void givenAFailingListing_whenChecked_thenTheProbeUserIsUnclearWithTheConnectorsReason() {
        // given
        simulator.force("getuserlist2", 500);

        // when
        List<ConnectionCheckRun.Checked> checked = checked(connector);

        // then
        assertThat(result(checked, "probe-user")).isEqualTo(CheckResult.failed("access.check.unclear",
                Map.of("reason", "getuserlist2 answered 500")));
    }

    @Test
    void givenAHangingGroupList_whenChecked_thenOnlyTheGroupsTimeOutAndTheLaterChecksStillReport() {
        // given
        Duration brief = Duration.ofSeconds(1);
        LoxoneAccessControl hurried = ready(connectorFor(simulator.settingsByUrl(brief)));
        simulator.hang("getgrouplist");

        // when
        List<ConnectionCheckRun.Checked> checked = checked(hurried, granted, brief);

        // then
        assertThat(result(checked, "groups")).isEqualTo(CheckResult.failed("access.check.timeout", Map.of()));
        assertThat(result(checked, "login").outcome()).isEqualTo(CheckOutcome.PASSED);
        assertThat(result(checked, "probe-user").outcome()).as("the call thread is free again after the timeout")
                .isEqualTo(CheckOutcome.PASSED);
    }

    @Test
    void givenAProbeUserLeftOnTheMiniserver_whenTheRemoteGrantIdsAreListed_thenItIsNeverAGrant() {
        // given
        simulator.ignoreDeletes();
        checked(connector);
        assertThat(probeUsers()).as("the probe user is still listed").hasSize(1);

        // when
        Optional<Set<UUID>> listed = connector.remoteGrantIds();

        // then
        assertThat(listed).contains(Set.of(simulator.foreignGrantId()));
    }

    private List<LoxoneSimulator.User> probeUsers() {
        return simulator.requests().stream().filter(request -> request.command().equals("addoredituser"))
                .map(request -> JSON.readTree(request.arguments().getFirst()).path("name").asString())
                .flatMap(name -> simulator.usersNamed(name).stream()).toList();
    }

    private List<ConnectionCheckRun.Checked> checked(LoxoneAccessControl checkedConnector) {
        return checked(checkedConnector, granted, DEADLINE);
    }

    private List<ConnectionCheckRun.Checked> checked(LoxoneAccessControl checkedConnector,
                                                     Map<UUID, String> accessPoints, Duration deadline) {
        try (CallRunner calls = new CallRunner(deadline)) {
            return ConnectionCheckRun.run(checkedConnector.connectionChecks(accessPoints), calls);
        }
    }

    private static CheckResult result(List<ConnectionCheckRun.Checked> checked, String name) {
        return checked.stream().filter(entry -> entry.check().equals(name)).map(ConnectionCheckRun.Checked::result)
                .findFirst().orElseThrow(() -> new AssertionError("no check named " + name));
    }
}
