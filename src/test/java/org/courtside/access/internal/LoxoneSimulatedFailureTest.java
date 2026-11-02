package org.courtside.access.internal;

import org.courtside.access.CheckOutcome;
import org.courtside.access.CheckResult;
import org.courtside.loxonesimulator.Failure;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.time.Duration;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LoxoneSimulatedFailureTest extends LoxoneTestSupport {

    private static final Map<Failure, Expected> EXPECTED = new EnumMap<>(Map.of(
            Failure.WRONG_CREDENTIALS, new Expected("login", CheckResult.failed("access.check.login.refused",
                    Map.of())),
            Failure.MISSING_RIGHT, new Expected("login", CheckResult.failed("access.check.login.missingRight",
                    Map.of())),
            Failure.LOCKED_USER, new Expected("login", CheckResult.failed("access.check.login.locked", Map.of())),
            Failure.DISABLED_USER, new Expected("login", CheckResult.failed("access.check.refused",
                    Map.of("reason", "Miniserver disabled the technical user (getkey2 423)"))),
            Failure.REFUSED_TOKEN, new Expected("groups", CheckResult.failed("access.check.refused",
                    Map.of("reason", "Miniserver refused the token for getgrouplist (401)"))),
            Failure.UNKNOWN_GROUP, new Expected("groups", CheckResult.failed("access.check.groups.missing",
                    Map.of("accessPoints", "North gate, South gate"))),
            Failure.OFFLINE, new Expected("miniserver", CheckResult.failed("access.check.address.noMiniserver",
                    Map.of("status", "502")))));

    private final Map<UUID, String> granted = Map.of(COURT_ONE, "North gate", COURT_TWO, "South gate");

    private record Expected(String check, CheckResult result) {
    }

    @ParameterizedTest
    @EnumSource(value = Failure.class, mode = EnumSource.Mode.EXCLUDE, names = "NONE")
    void givenASelectedFailure_whenChecked_thenItsOwnCheckReportsItsOwnResult(Failure failure) {
        // given
        Expected expected = EXPECTED.get(failure);
        simulator.fail(failure);

        // when
        List<ConnectionCheckRun.Checked> checked = checked();

        // then
        assertThat(result(checked, expected.check())).as("%s shows on the %s check", failure.label(),
                expected.check()).isEqualTo(expected.result());
        assertThat(simulator.failure()).isEqualTo(failure);
    }

    @Test
    void whenEveryFailureIsListed_thenEachHasAResultNoOtherFailureShares() {
        // when
        Set<Expected> distinct = new HashSet<>(EXPECTED.values());

        // then
        assertThat(EXPECTED.keySet()).as("every failure but none has an expected result")
                .containsExactlyInAnyOrderElementsOf(Set.of(Failure.values()).stream()
                        .filter(failure -> failure != Failure.NONE).toList());
        assertThat(distinct).as("a board tells the failures apart by check and result").hasSize(EXPECTED.size());
    }

    @ParameterizedTest
    @EnumSource(value = Failure.class, mode = EnumSource.Mode.EXCLUDE, names = "NONE")
    void givenASelectedFailure_whenNoneIsSelectedAndTheConnectorsOwnLockHasRunOut_thenEveryCheckPassesAgain(
            Failure failure) {
        // given
        simulator.fail(failure);
        checked();
        simulator.fail(Failure.NONE);
        clock.advance(Duration.ofMinutes(6));

        // when
        List<ConnectionCheckRun.Checked> checked = checked();

        // then
        assertThat(checked).extracting(entry -> entry.result().outcome()).as("after %s", failure.label())
                .containsExactly(CheckOutcome.PASSED, CheckOutcome.PASSED, CheckOutcome.PASSED,
                        CheckOutcome.PASSED, CheckOutcome.MANUAL);
    }

    @Test
    void givenTwoSimulators_whenTheirGroupsAreRead_thenAGroupKeepsItsIdentifierAcrossThem() throws Exception {
        // given
        try (var other = SimulatedMiniserver.started(clock)) {

            // when
            String again = other.groupUuid("Court 1");

            // then
            assertThat(again).as("a mapped group survives a simulator restart")
                    .isEqualTo(simulator.groupUuid("Court 1"))
                    .matches(LoxoneAccessControl.LOXONE_UUID);
        }
    }

    private List<ConnectionCheckRun.Checked> checked() {
        try (CallRunner calls = new CallRunner(DEADLINE)) {
            return ConnectionCheckRun.run(connector.connectionChecks(granted), calls);
        }
    }

    private static CheckResult result(List<ConnectionCheckRun.Checked> checked, String name) {
        return checked.stream().filter(entry -> entry.check().equals(name)).map(ConnectionCheckRun.Checked::result)
                .findFirst().orElseThrow(() -> new AssertionError("no check named " + name));
    }
}
