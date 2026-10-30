package org.courtside.access.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.courtside.access.GrantOutcome;
import org.courtside.access.GrantStatus;
import org.courtside.access.ProbeOutcome;
import org.courtside.access.Scope;
import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "access_grant")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AccessGrant {

    private static final List<Duration> BACKOFF = List.of(Duration.ofMinutes(1), Duration.ofMinutes(5),
            Duration.ofMinutes(15), Duration.ofMinutes(60));
    private static final Duration UNCLEAR_OUTAGE_RETRY = Duration.ofMinutes(1);
    private static final Duration LONGEST_HOLD = Duration.ofMinutes(60);
    private static final int MOST_REJECTIONS = 3;
    private static final int FAILING_ATTEMPTS = 5;
    private static final int MOST_MAPPING_CHARACTERS = 200;
    private static final int MOST_FAILURE_CHARACTERS = 500;
    private static final String UNCLEAR = "The access-control system gave no clear answer";
    private static final String CODE_REJECTED = "The access-control system rejected the code";

    @Id
    private UUID id;

    @Column(nullable = false)
    private UUID bookingId;

    private Instant firstAcceptedAt;

    @Column(nullable = false)
    private boolean wanted;

    private Instant wantFrom;

    private Instant wantUntil;

    @Getter(AccessLevel.NONE)
    private UUID[] wantPoints;

    private String wantMapping;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RemoteState remote;

    private Instant remoteFrom;

    private Instant remoteUntil;

    @Getter(AccessLevel.NONE)
    private UUID[] remotePoints;

    private String remoteMapping;

    private Instant exposedUntil;

    private Instant lastInstallSentAt;

    private String externalReference;

    @Column(nullable = false)
    private int attempts;

    @Column(nullable = false)
    private int rejections;

    private Instant nextAttemptAt;

    private String lastFailure;

    @Column(nullable = false)
    private boolean refused;

    private Instant retryRequestedAt;

    void requestRetry(Instant at) {
        retryRequestedAt = at;
    }

    GrantStatus status() {
        if (failing()) {
            return GrantStatus.FAILING;
        }
        if (!wanted && remote != RemoteState.NONE) {
            return GrantStatus.REMOVING;
        }
        if (!wanted && attempts == 0) {
            return GrantStatus.DONE;
        }
        return remote == RemoteState.INSTALLED && installedAsWanted() ? GrantStatus.INSTALLED : GrantStatus.WAITING;
    }

    private boolean failing() {
        return refused || attempts >= FAILING_ATTEMPTS;
    }

    Action action() {
        if (!wanted) {
            return remote == RemoteState.NONE ? Action.NONE : Action.REVOKE;
        }
        if (refused) {
            boolean exposedBeyondWanted = remote == RemoteState.MAYBE
                    || (remote == RemoteState.INSTALLED && !installedAsWanted());
            return exposedBeyondWanted ? Action.REVOKE : Action.NONE;
        }
        if (remote != RemoteState.INSTALLED) {
            return Action.GRANT;
        }
        return installedAsWanted() ? Action.NONE : Action.RESCHEDULE;
    }

    Action decide(@Nullable Demand demand, @Nullable String mapping, Instant dbNow) {
        if (demand != null && mapping == null) {
            throw new IllegalStateException("A demand is decided with the connector's mapping fingerprint");
        }
        if (mapping != null && mapping.length() > MOST_MAPPING_CHARACTERS) {
            throw new IllegalStateException("The connector's mapping fingerprint has more than 200 characters");
        }
        boolean nowWanted = demand != null && dbNow.isBefore(demand.validUntil());
        boolean changed = nowWanted != wanted || !wants(demand, mapping);
        wanted = nowWanted;
        wantFrom = demand == null ? null : demand.validFrom();
        wantUntil = demand == null ? null : demand.validUntil();
        wantPoints = demand == null ? null : demand.accessPointIds().toArray(UUID[]::new);
        wantMapping = demand == null ? null : mapping;
        if (changed || retryRequestedAt != null) {
            retryRequestedAt = null;
            attempts = 0;
            rejections = 0;
            refused = false;
            nextAttemptAt = dbNow;
        }
        Action action = action();
        if (action == Action.NONE && !wanted && remote == RemoteState.NONE) {
            nextAttemptAt = null;
        }
        if (action == Action.NONE || (nextAttemptAt != null && nextAttemptAt.isAfter(dbNow))) {
            return Action.NONE;
        }
        return action;
    }

    boolean decisionFailed(String reason, Instant dbNow) {
        boolean failingBefore = failing();
        lastFailure = stored(reason, null);
        if (nextAttemptAt == null || !nextAttemptAt.isAfter(dbNow)) {
            attempts++;
            nextAttemptAt = dbNow.plus(backoff(attempts));
        }
        return !failingBefore && failing();
    }

    SentCall beginCall(Action action, @Nullable String code, Instant dbNow) {
        if (action == Action.NONE || action != action()) {
            throw new IllegalStateException("A call begins only for the action the row is due for, not " + action);
        }
        if (action.installs()) {
            if (code == null) {
                throw new IllegalStateException("An install sends the grant's current code");
            }
            exposedUntil = exposedUntil == null || wantUntil.isAfter(exposedUntil) ? wantUntil : exposedUntil;
            remote = RemoteState.MAYBE;
            lastInstallSentAt = dbNow;
        }
        Instant previousNextAttemptAt = nextAttemptAt;
        int previousAttempts = attempts;
        attempts++;
        nextAttemptAt = dbNow.plus(backoff(attempts));
        return new SentCall(action, id, dbNow, wantFrom, wantUntil, getWantPoints(), wantMapping,
                action.installs() ? code : null, externalReference, previousNextAttemptAt, previousAttempts);
    }

    static boolean needsReProbe(Action action, CallResult result) {
        return switch (result) {
            case CallResult.Unclear _ -> true;
            case CallResult.Answered(GrantOutcome.CodeRejected _) -> action == Action.REVOKE;
            case CallResult.Answered(GrantOutcome.RetryLater later) -> later.scope() == Scope.CONNECTOR;
            case CallResult.Answered(GrantOutcome.Refused refusal) -> refusal.scope() == Scope.CONNECTOR;
            case CallResult.Answered _ -> false;
        };
    }

    Recording record(SentCall call, CallResult result, @Nullable ProbeOutcome reprobe, Instant dbNow,
                     Duration deadline) {
        boolean failingBefore = refused || call.previousAttempts() >= FAILING_ATTEMPTS;
        boolean acceptedBefore = firstAcceptedAt != null;
        Recording recorded = recordAnswer(call, result, reprobe, dbNow, deadline);
        return new Recording(recorded.effect(), recorded.replaceCode(), !acceptedBefore && firstAcceptedAt != null,
                !failingBefore && failing());
    }

    private Recording recordAnswer(SentCall call, CallResult result, @Nullable ProbeOutcome reprobe, Instant dbNow,
                                   Duration deadline) {
        if (!id.equals(call.grantId())) {
            throw new IllegalStateException("A call is recorded on the grant it was sent for");
        }
        boolean probes = needsReProbe(call.action(), result);
        if (probes && reprobe == null) {
            throw new IllegalStateException("This answer is recorded with the result of a fresh probe");
        }
        boolean probeAnswers = reprobe instanceof ProbeOutcome.Answered;
        if (result instanceof CallResult.Answered(GrantOutcome outcome)
                && !(outcome instanceof GrantOutcome.CodeRejected && call.action() == Action.REVOKE)) {
            return recordOutcome(call, outcome, probes, probeAnswers, dbNow, deadline);
        }
        lastFailure = UNCLEAR;
        if (probeAnswers) {
            return new Recording(new PassEffect.Continue(), false);
        }
        attempts--;
        nextAttemptAt = dbNow.plus(UNCLEAR_OUTAGE_RETRY);
        return new Recording(new PassEffect.Outage(), false);
    }

    private Recording recordOutcome(SentCall call, GrantOutcome outcome, boolean connectorScope, boolean probeAnswers,
                                   Instant dbNow, Duration deadline) {
        PassEffect effect = new PassEffect.Continue();
        if (outcome instanceof GrantOutcome.RetryLater(Scope scope, Instant notBefore, String _)
                && scope == Scope.CONNECTOR && notBefore != null && notBefore.isAfter(dbNow)) {
            Instant longest = dbNow.plus(LONGEST_HOLD);
            effect = new PassEffect.Hold(notBefore.isAfter(longest) ? longest : notBefore);
        }
        if (connectorScope && !probeAnswers) {
            attempts--;
            nextAttemptAt = call.previousNextAttemptAt();
            lastFailure = reasonOf(outcome, call.code());
            return new Recording(effect instanceof PassEffect.Hold ? effect : new PassEffect.Outage(), false);
        }
        boolean replaceCode = false;
        switch (outcome) {
            case GrantOutcome.Accepted(String reference) -> {
                if (call.action().installs()) {
                    installed(call, reference, dbNow);
                } else {
                    revoked(call, deadline);
                }
            }
            case GrantOutcome.CodeRejected _ -> {
                lastFailure = CODE_REJECTED;
                if (firstAcceptedAt == null) {
                    rejections++;
                    nextAttemptAt = dbNow;
                    refused = rejections >= MOST_REJECTIONS;
                    replaceCode = true;
                } else {
                    refused = true;
                    nextAttemptAt = dbNow;
                }
            }
            case GrantOutcome.RetryLater(Scope _, Instant notBefore, String reason) -> {
                lastFailure = stored(reason, call.code());
                Instant bounded = notBefore == null || notBefore.isBefore(dbNow.plus(LONGEST_HOLD))
                        ? notBefore : dbNow.plus(LONGEST_HOLD);
                if (bounded != null && bounded.isAfter(nextAttemptAt)) {
                    nextAttemptAt = bounded;
                }
            }
            case GrantOutcome.Refused(Scope _, String reason) -> {
                lastFailure = stored(reason, call.code());
                if (call.action().installs()) {
                    refused = true;
                    nextAttemptAt = dbNow;
                }
            }
        }
        return new Recording(effect, replaceCode);
    }

    private void installed(SentCall call, String reference, Instant dbNow) {
        remote = RemoteState.INSTALLED;
        remoteFrom = call.validFrom();
        remoteUntil = call.validUntil();
        remotePoints = call.accessPointIds().toArray(UUID[]::new);
        remoteMapping = call.mapping();
        externalReference = reference;
        if (firstAcceptedAt == null) {
            firstAcceptedAt = dbNow;
        }
        attempts = 0;
        rejections = 0;
        lastFailure = null;
    }

    private void revoked(SentCall call, Duration deadline) {
        attempts = 0;
        lastFailure = null;
        Instant lateInstallBound = lastInstallSentAt == null ? null : lastInstallSentAt.plus(deadline.multipliedBy(2));
        if (lateInstallBound != null && call.sentAt().isBefore(lateInstallBound)) {
            remote = RemoteState.MAYBE;
            nextAttemptAt = lateInstallBound;
        } else {
            remote = RemoteState.NONE;
        }
    }

    private boolean installedAsWanted() {
        return Objects.equals(wantFrom, remoteFrom) && Objects.equals(wantUntil, remoteUntil)
                && getWantPoints().equals(getRemotePoints()) && Objects.equals(wantMapping, remoteMapping);
    }

    private boolean wants(@Nullable Demand demand, @Nullable String mapping) {
        if (demand == null) {
            return wantFrom == null && wantUntil == null && wantPoints == null && wantMapping == null;
        }
        return demand.validFrom().equals(wantFrom) && demand.validUntil().equals(wantUntil)
                && demand.accessPointIds().equals(getWantPoints()) && Objects.equals(mapping, wantMapping);
    }

    private static Duration backoff(int attempts) {
        return BACKOFF.get(Math.min(attempts, BACKOFF.size()) - 1);
    }

    private static String reasonOf(GrantOutcome outcome, @Nullable String code) {
        return switch (outcome) {
            case GrantOutcome.RetryLater later -> stored(later.reason(), code);
            case GrantOutcome.Refused refusal -> stored(refusal.reason(), code);
            default -> UNCLEAR;
        };
    }

    private static String stored(String reason, @Nullable String code) {
        String masked = ConnectorText.sanitized(reason, code);
        return masked.length() > MOST_FAILURE_CHARACTERS ? masked.substring(0, MOST_FAILURE_CHARACTERS) : masked;
    }

    public Set<UUID> getWantPoints() {
        return points(wantPoints);
    }

    public Set<UUID> getRemotePoints() {
        return points(remotePoints);
    }

    private static Set<UUID> points(UUID[] stored) {
        return stored == null ? Set.of() : Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(stored)));
    }
}
