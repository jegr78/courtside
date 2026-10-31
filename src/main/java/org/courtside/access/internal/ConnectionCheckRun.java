package org.courtside.access.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.access.AccessControlConnector;
import org.courtside.access.CheckOutcome;
import org.courtside.access.CheckResult;
import org.courtside.access.ConnectionCheck;
import org.courtside.facility.AccessPoint;
import org.courtside.facility.FacilityService;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/** Runs a board's requested connection check, each check as its own call, and keeps what each one found. */
@Slf4j
@Component
@ConnectorSelected
class ConnectionCheckRun {

    record Checked(String check, CheckResult result) {
    }

    private static final Duration FREED_WITHIN = Duration.ofSeconds(1);

    private final AccessControlConnector connector;
    private final CallRunner calls;
    private final FacilityService facility;
    private final PassClock clock;
    private final ConnectionCheckReadings readings;

    ConnectionCheckRun(AccessControlConnector connector, CallRunner calls, FacilityService facility, PassClock clock,
                       ConnectionCheckReadings readings) {
        this.connector = connector;
        this.calls = calls;
        this.facility = facility;
        this.clock = clock;
        this.readings = readings;
    }

    /** Runs a requested check while {@code proceed} holds; a run it cuts short records nothing and stays requested. */
    void runIfRequested(BooleanSupplier proceed) {
        if (!readings.takeRequest()) {
            return;
        }
        try {
            Map<UUID, String> granted = new LinkedHashMap<>();
            for (AccessPoint accessPoint : facility.activeAccessPointsWithoutCodes()) {
                granted.put(accessPoint.getId(), accessPoint.getName());
            }
            Optional<List<Checked>> checked = run(connector.connectionChecks(granted), calls, proceed);
            if (checked.isEmpty()) {
                readings.request();
                return;
            }
            readings.record(clock.now(), checked.get());
        } catch (RuntimeException failed) {
            log.warn("The connection check could not start: {}: {}", failed.getClass().getName(),
                    ConnectorText.sanitized(failed.getMessage(), null));
            readings.record(clock.now(), List.of(new Checked("connector",
                    CheckResult.failed("access.check.failed", Map.of()))));
        }
    }

    static List<Checked> run(List<ConnectionCheck> checks, CallRunner calls) {
        return run(checks, calls, () -> true).orElseThrow();
    }

    private static Optional<List<Checked>> run(List<ConnectionCheck> checks, CallRunner calls,
                                               BooleanSupplier proceed) {
        Map<String, CheckOutcome> outcomes = new LinkedHashMap<>();
        List<Checked> checked = new ArrayList<>();
        for (ConnectionCheck check : checks) {
            if (!proceed.getAsBoolean()) {
                return Optional.empty();
            }
            List<String> unmet = check.requires().stream()
                    .filter(required -> outcomes.get(required) != CheckOutcome.PASSED).toList();
            CheckResult result = unmet.isEmpty() ? called(check, calls)
                    : CheckResult.skipped("access.check.skipped", Map.of("requires", String.join(", ", unmet)));
            outcomes.put(check.name(), result.outcome());
            checked.add(new Checked(check.name(), result));
        }
        return Optional.of(List.copyOf(checked));
    }

    private static CheckResult called(ConnectionCheck check, CallRunner calls) {
        calls.awaitIdle(FREED_WITHIN);
        return switch (calls.run(() -> check.run().get())) {
            case CallRunner.Result.Done<CheckResult>(CheckResult result) when result != null -> result;
            case CallRunner.Result.Busy<CheckResult> busy ->
                    CheckResult.failed("access.check.callThreadOccupied", Map.of());
            case CallRunner.Result.Unclear<CheckResult>(Throwable cause) when cause == null ->
                    CheckResult.failed("access.check.timeout", Map.of());
            case CallRunner.Result.Unclear<CheckResult>(Throwable cause) -> unclear(check, cause);
            default -> CheckResult.failed("access.check.unanswered", Map.of());
        };
    }

    private static CheckResult unclear(ConnectionCheck check, Throwable cause) {
        log.warn("The connection check {} failed: {}: {}", check.name(), cause.getClass().getName(),
                ConnectorText.sanitized(cause.getMessage(), null));
        return CheckResult.failed("access.check.failed", Map.of());
    }
}
