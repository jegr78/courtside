package org.courtside.access.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.access.AccessControlConnector;
import org.courtside.access.GrantOutcome;
import org.courtside.access.ProbeOutcome;
import org.courtside.shared.AccessDemand;
import org.courtside.shared.BookingAnnouncer;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/** One pass over the access grants: insert what the bookings ask for, act on open rows, release codes. */
@Slf4j
@Component
@ConnectorSelected
class AccessPass {

    private static final UUID FIRST = new UUID(0, 0);
    private static final ProbeOutcome NO_PROBE_ANSWER = new ProbeOutcome.Unreachable("The probe gave no answer");
    private static final String OCCUPIED = "the call thread is still occupied by an abandoned call";

    private final DataSource dataSource;
    private final TransactionTemplate transactions;
    private final JdbcClient jdbc;
    private final PassClock clock;
    private final BookingAnnouncer announcer;
    private final AccessGrantRepository grants;
    private final AccessGrantTransitions transitions;
    private final AccessCodes codes;
    private final AccessControlConnector connector;
    private final CallRunner calls;
    private final ProvisioningWindow window;
    private final Duration deadline;
    private final int pageSize;
    private final ProbeReadings readings;

    AccessPass(DataSource dataSource, PlatformTransactionManager transactionManager, JdbcClient jdbc, PassClock clock,
               BookingAnnouncer announcer, AccessGrantRepository grants, AccessGrantTransitions transitions,
               AccessCodes codes, AccessControlConnector connector, CallRunner calls, ProvisioningWindow window,
               @Value("${courtside.access-control.call-deadline}") Duration deadline,
               @Value("${courtside.access-control.insert-page-size}") int pageSize, ProbeReadings readings) {
        this.dataSource = dataSource;
        this.transactions = new TransactionTemplate(transactionManager);
        this.jdbc = jdbc;
        this.clock = clock;
        this.announcer = announcer;
        this.grants = grants;
        this.transitions = transitions;
        this.codes = codes;
        this.connector = connector;
        this.calls = calls;
        this.window = window;
        this.deadline = deadline;
        this.pageSize = pageSize;
        this.readings = readings;
    }

    PassResult runPassNow() {
        return runPassNow(() -> false);
    }

    synchronized PassResult runPassNow(BooleanSupplier stopping) {
        Optional<PassLock> acquired = PassLock.tryAcquire(dataSource);
        if (acquired.isEmpty()) {
            return new PassResult.Skipped();
        }
        try (PassLock lock = acquired.get()) {
            try {
                insertDemanded(stopping);
            } catch (RuntimeException failed) {
                log.warn("The access pass could not insert the grants bookings ask for", failed);
            }
            PassResult result = act(lock, stopping);
            release();
            return result;
        }
    }

    private void insertDemanded(BooleanSupplier stopping) {
        Instant now = clock.now();
        Instant before = window.endsAt(now);
        UUID after = FIRST;
        List<AccessDemand> page = announcer.accessDemandsStartingBefore(before, now, after, pageSize);
        while (!page.isEmpty() && !stopping.getAsBoolean()) {
            for (AccessDemand demand : page) {
                jdbc.sql("""
                                INSERT INTO access_grant (id, booking_id, next_attempt_at) VALUES (:id, :booking, :now)
                                ON CONFLICT (booking_id) DO UPDATE SET next_attempt_at = :now
                                WHERE access_grant.remote = 'NONE' AND NOT access_grant.wanted
                                    AND access_grant.attempts = 0
                                """)
                        .param("id", UUID.randomUUID()).param("booking", demand.bookingId())
                        .param("now", Timestamp.from(now)).update();
            }
            after = page.getLast().bookingId();
            page = announcer.accessDemandsStartingBefore(before, now, after, pageSize);
        }
    }

    private PassResult act(PassLock lock, BooleanSupplier stopping) {
        List<UUID> open = jdbc.sql("""
                        SELECT id FROM access_grant
                        WHERE wanted OR remote <> 'NONE' OR next_attempt_at <= :now OR retry_requested_at IS NOT NULL
                        ORDER BY wanted, remote = 'NONE', id
                        """)
                .param("now", Timestamp.from(clock.now())).query(UUID.class).list();
        boolean probedThisPass = false;
        if (readings.takeRequest()) {
            if (!lock.stillHeld()) {
                return new PassResult.LockLost();
            }
            ProbeOutcome requested = probe();
            if (!(requested instanceof ProbeOutcome.Answered)) {
                return outage(requested);
            }
            probedThisPass = true;
        }
        for (UUID grantId : open) {
            if (stopping.getAsBoolean()) {
                return new PassResult.Stopped();
            }
            Prepared prepared = prepare(grantId, probedThisPass);
            if (prepared instanceof Prepared.NeedsProbe) {
                if (!lock.stillHeld()) {
                    return new PassResult.LockLost();
                }
                ProbeOutcome probed = probe();
                if (!(probed instanceof ProbeOutcome.Answered)) {
                    return outage(probed);
                }
                probedThisPass = true;
                prepared = prepare(grantId, true);
            }
            if (prepared instanceof Prepared.Ready(SentCall call)) {
                PassResult ended = callAndRecord(lock, call);
                if (ended != null) {
                    return ended;
                }
            }
        }
        return new PassResult.Completed();
    }

    private Prepared prepare(UUID grantId, boolean probed) {
        try {
            return transactions.execute(status -> {
                Instant now = clock.now();
                AccessGrant grant = grants.findLockedById(grantId).orElse(null);
                if (grant == null) {
                    return new Prepared.NoCall();
                }
                AccessDemand demanded = announcer.accessDemands(Set.of(grant.getBookingId())).get(grant.getBookingId());
                Demand demand = demanded == null ? null
                        : new Demand(demanded.validFrom(), demanded.validUntil(), demanded.accessPointIds());
                String mapping = demand == null ? null : connector.mappingOf(demand.accessPointIds());
                Decision decision = transitions.decide(grant, demand, mapping, now);
                if (decision.action() == Action.NONE) {
                    return new Prepared.NoCall();
                }
                if (!probed) {
                    status.setRollbackOnly();
                    return new Prepared.NeedsProbe();
                }
                return new Prepared.Ready(grant.beginCall(decision.action(), decision.code(), now));
            });
        } catch (RuntimeException failed) {
            log.warn("Access grant {} could not be decided", grantId, failed);
            recordDecisionFailure(grantId, failed);
            return new Prepared.NoCall();
        }
    }

    private void recordDecisionFailure(UUID grantId, RuntimeException failed) {
        String reason = "The grant could not be decided: "
                + (failed.getMessage() == null ? failed.getClass().getSimpleName() : failed.getMessage());
        try {
            transactions.executeWithoutResult(status -> grants.findLockedById(grantId)
                    .ifPresent(grant -> transitions.decisionFailed(grant, reason, clock.now())));
        } catch (RuntimeException unrecorded) {
            log.warn("The failed decision of access grant {} could not be recorded", grantId, unrecorded);
        }
    }

    private @Nullable PassResult callAndRecord(PassLock lock, SentCall call) {
        if (!lock.stillHeld()) {
            return new PassResult.LockLost();
        }
        CallResult result = send(call);
        ProbeOutcome reprobe = null;
        if (AccessGrant.needsReProbe(call.action(), result)) {
            if (!lock.stillHeld()) {
                return new PassResult.LockLost();
            }
            reprobe = probe();
        }
        ProbeOutcome probeResult = reprobe;
        Instant[] recordedAt = new Instant[1];
        Recording recording;
        try {
            recording = transactions.execute(status -> {
                recordedAt[0] = clock.now();
                AccessGrant grant = grants.findLockedById(call.grantId())
                        .orElseThrow(() -> new IllegalStateException("A grant that was called still exists"));
                return transitions.record(grant, call, result, probeResult, recordedAt[0], deadline);
            });
        } catch (RuntimeException lost) {
            log.warn("The answer for access grant {} could not be recorded", call.grantId(), lost);
            return null;
        }
        return switch (recording.effect()) {
            case PassEffect.Continue ignored -> null;
            case PassEffect.Outage ignored -> outage(probeResult);
            case PassEffect.Hold(Instant until) -> new PassResult.Held(Duration.between(recordedAt[0], until));
        };
    }

    private CallResult send(SentCall call) {
        CallRunner.Result<GrantOutcome> sent = calls.run(() -> switch (call.action()) {
            case GRANT -> connector.grant(call.instruction());
            case RESCHEDULE -> connector.reschedule(call.instruction());
            case REVOKE -> connector.revoke(call.reference());
            case NONE -> throw new IllegalStateException("No call is sent for a row that needs none");
        });
        switch (sent) {
            case CallRunner.Result.Done<GrantOutcome>(GrantOutcome outcome) when outcome != null -> {
                return new CallResult.Answered(outcome);
            }
            case CallRunner.Result.Busy<GrantOutcome> busy -> log.warn("Access grant {} {} was not sent: {}",
                    call.grantId(), call.action(), OCCUPIED);
            case CallRunner.Result.Unclear<GrantOutcome>(Throwable cause) -> log.warn(
                    "Access grant {} {} gave no clear answer: {}", call.grantId(), call.action(),
                    describe(cause, call.code()));
            default -> log.warn("Access grant {} {} gave no clear answer: it answered nothing", call.grantId(),
                    call.action());
        }
        return new CallResult.Unclear();
    }

    private String describe(@Nullable Throwable cause, @Nullable String code) {
        if (cause == null) {
            return "no answer within " + deadline;
        }
        return cause.getClass().getName() + ": " + ConnectorText.sanitized(cause.getMessage(), code);
    }

    private PassResult outage(@Nullable ProbeOutcome probe) {
        String reason = switch (probe) {
            case ProbeOutcome.Unreachable(String why) -> ConnectorText.sanitized(why, null);
            case ProbeOutcome.Refused(String why) -> ConnectorText.sanitized(why, null);
            case null, default -> "the connector refused a call for the whole connector";
        };
        log.warn("The access pass ends as an outage: {}", reason);
        return new PassResult.Outage();
    }

    private ProbeOutcome probe() {
        CallRunner.Result<ProbeOutcome> probed = calls.run(connector::probe);
        Instant checkedAt = clock.now();
        return switch (probed) {
            case CallRunner.Result.Done<ProbeOutcome>(ProbeOutcome outcome) when outcome != null -> {
                readings.record(outcome, checkedAt);
                yield outcome;
            }
            case CallRunner.Result.Busy<ProbeOutcome> busy -> {
                readings.record(ProbeClassification.CALL_THREAD_OCCUPIED, checkedAt);
                yield new ProbeOutcome.Unreachable("The probe was not sent: " + OCCUPIED);
            }
            case CallRunner.Result.Unclear<ProbeOutcome>(Throwable cause) -> {
                readings.record(cause == null ? ProbeClassification.TIMEOUT : ProbeClassification.UNREACHABLE,
                        checkedAt);
                yield new ProbeOutcome.Unreachable("The probe gave no clear answer: " + describe(cause, null));
            }
            default -> {
                readings.record(ProbeClassification.UNREACHABLE, checkedAt);
                yield NO_PROBE_ANSWER;
            }
        };
    }

    private void release() {
        Instant now = clock.now();
        transactions.executeWithoutResult(status -> {
            codes.releaseSettled(now);
            codes.deleteExpired(now);
        });
    }

    private sealed interface Prepared {

        record NoCall() implements Prepared {
        }

        record NeedsProbe() implements Prepared {
        }

        record Ready(SentCall call) implements Prepared {
        }
    }
}
