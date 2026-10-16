package org.courtside.dataexchange;

import lombok.extern.slf4j.Slf4j;
import org.courtside.config.ClubTimeZone;
import org.courtside.dataexchange.RetentionPlan.Blocked;
import org.courtside.dataexchange.RetentionPlan.BlockReason;
import org.courtside.dataexchange.internal.RetentionRows;
import org.courtside.shared.DatabaseDeadlines;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@NullMarked
@Service
@Transactional(readOnly = true, timeoutString = DatabaseDeadlines.REPORT)
public class RetentionService {

    static final int MINIMUM_MONTHS = 1;
    static final int MAXIMUM_MONTHS = 1200;

    private final RetentionRows rows;
    private final ClubTimeZone clubTimeZone;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final Duration previewLifetime;

    RetentionService(RetentionRows rows, ClubTimeZone clubTimeZone, ApplicationEventPublisher events, Clock clock,
                     @Value("${courtside.retention.preview-lifetime}") Duration previewLifetime) {
        this.rows = rows;
        this.clubTimeZone = clubTimeZone;
        this.events = events;
        this.clock = clock;
        this.previewLifetime = previewLifetime;
    }

    public List<RetentionPlan.Policy> policies() {
        Map<RetentionCategory, Integer> configured = rows.policies();
        return Arrays.stream(RetentionCategory.values())
                .map(category -> new RetentionPlan.Policy(category, configured.get(category)))
                .toList();
    }

    @Transactional(timeoutString = DatabaseDeadlines.REPORT)
    public RetentionPlan.Policy setPolicy(RetentionCategory category, @Nullable Integer retainMonths) {
        if (category == null) {
            throw new IllegalStateException("A retention period needs its category");
        }
        if (retainMonths == null || retainMonths < MINIMUM_MONTHS || retainMonths > MAXIMUM_MONTHS) {
            throw new RetentionPeriodInvalidException("A retention period is 1 to 1200 months, not " + retainMonths);
        }
        rows.discardPreviewsCovering(category);
        rows.setPolicy(category, retainMonths);
        events.publishEvent(new DataExchangeEvent.RetentionPolicySet(category, retainMonths));
        return new RetentionPlan.Policy(category, retainMonths);
    }

    @Transactional(timeoutString = DatabaseDeadlines.REPORT)
    public void removePolicy(RetentionCategory category) {
        if (category == null) {
            throw new IllegalStateException("Removing a retention period needs its category");
        }
        rows.discardPreviewsCovering(category);
        if (rows.removePolicy(category)) {
            events.publishEvent(new DataExchangeEvent.RetentionPolicyRemoved(category));
        }
    }

    @Transactional(timeoutString = DatabaseDeadlines.REPORT)
    public RetentionPlan.Preview preview(UUID accountId) {
        if (accountId == null) {
            throw new IllegalStateException("A retention preview needs the account that reviews it");
        }
        Map<RetentionCategory, Integer> configured = rows.policies();
        if (configured.isEmpty()) {
            throw new RetentionNotConfiguredException("No record category has a retention period");
        }
        Instant now = clock.instant();
        ZoneId zone = clubTimeZone.zoneId();
        LocalDate today = now.atZone(zone).toLocalDate();
        rows.deleteExpiredPreviews(now);

        Instant bookingsEndedBefore = cutoff(configured.get(RetentionCategory.BOOKINGS), today, zone);
        RetentionPlan.Bookings bookings = bookingsEndedBefore == null ? null
                : new RetentionPlan.Bookings(bookingsEndedBefore, rows.dueBookings(bookingsEndedBefore),
                rows.dueSeries(bookingsEndedBefore));

        Integer memberMonths = configured.get(RetentionCategory.FORMER_MEMBERS);
        LocalDate membershipsEndedBefore = memberMonths == null ? null : today.minusMonths(memberMonths);
        List<UUID> removable = List.of();
        List<Blocked> blocked = List.of();
        RetentionPlan.FormerMembers formerMembers = null;
        if (membershipsEndedBefore != null) {
            List<UUID> eligible = rows.formerMembers(membershipsEndedBefore,
                    membershipsEndedBefore.atStartOfDay(zone).toInstant());
            Map<UUID, BlockReason> blocks = rows.blocks(eligible, bookingsEndedBefore);
            removable = eligible.stream().filter(personId -> !blocks.containsKey(personId)).toList();
            blocked = blocks.entrySet().stream().map(entry -> new Blocked(entry.getKey(), entry.getValue())).toList();
            formerMembers = new RetentionPlan.FormerMembers(membershipsEndedBefore, removable.size(),
                    rows.accountsOf(removable));
        }

        UUID previewId = UUID.randomUUID();
        Instant expiresAt = now.plus(previewLifetime);
        rows.savePreview(previewId, accountId, now, expiresAt, bookingsEndedBefore, membershipsEndedBefore, removable);
        return new RetentionPlan.Preview(previewId, expiresAt, bookings, formerMembers, blocked);
    }

    @Transactional(timeoutString = DatabaseDeadlines.REPORT)
    public RetentionPlan.Run run(UUID previewId, UUID accountId) {
        if (previewId == null || accountId == null) {
            throw new IllegalStateException("A retention run needs its preview and the account that runs it");
        }
        RetentionRows.StoredPreview preview = rows.lockPreview(previewId).orElseThrow(() ->
                new RetentionPreviewNotFoundException("No retention preview with id " + previewId));
        if (!preview.createdBy().equals(accountId)) {
            throw new RetentionPreviewActorMismatchException("Retention preview " + previewId
                    + " belongs to another account");
        }
        Instant now = clock.instant();
        if (!preview.expiresAt().isAfter(now)) {
            throw new RetentionPreviewExpiredException("Retention preview " + previewId + " has expired");
        }
        requireTheSamePeriods(preview);
        rows.deletePreview(previewId);

        long[] pseudonymised = preview.bookingsEndedBefore() == null ? new long[]{0, 0}
                : rows.pseudonymise(preview.bookingsEndedBefore(), now);
        long removed = 0;
        long accounts = 0;
        long skipped = 0;
        LocalDate membershipsEndedBefore = preview.membershipsEndedBefore();
        if (membershipsEndedBefore != null) {
            Instant activeSince = membershipsEndedBefore.atStartOfDay(clubTimeZone.zoneId()).toInstant();
            for (UUID personId : preview.formerMemberIds().stream().sorted().toList()) {
                var outcome = rows.removeIfStillEligible(personId, membershipsEndedBefore, activeSince);
                if (outcome.isPresent()) {
                    removed++;
                    accounts += outcome.get();
                } else {
                    skipped++;
                }
            }
        }
        UUID runId = UUID.randomUUID();
        RetentionPlan.Run run = new RetentionPlan.Run(runId, pseudonymised[0], pseudonymised[1], removed, accounts,
                skipped);
        events.publishEvent(new DataExchangeEvent.RetentionRun(runId, run.bookingsPseudonymised(),
                run.seriesPseudonymised(), run.formerMembersRemoved(), run.accountsRemoved(),
                run.formerMembersSkipped()));
        log.info("Retention run {}: {} bookings and {} series pseudonymised, {} former members with {} accounts "
                        + "removed, {} skipped", runId, run.bookingsPseudonymised(), run.seriesPseudonymised(),
                run.formerMembersRemoved(), run.accountsRemoved(), run.formerMembersSkipped());
        return run;
    }

    // A period changed or removed since the preview discards it; this holds that against a change racing the run.
    private void requireTheSamePeriods(RetentionRows.StoredPreview preview) {
        Map<RetentionCategory, Integer> configured = rows.lockPolicies();
        ZoneId zone = clubTimeZone.zoneId();
        LocalDate previewedOn = preview.createdAt().atZone(zone).toLocalDate();
        boolean bookingsKept = preview.bookingsEndedBefore() == null || preview.bookingsEndedBefore()
                .equals(cutoff(configured.get(RetentionCategory.BOOKINGS), previewedOn, zone));
        Integer memberMonths = configured.get(RetentionCategory.FORMER_MEMBERS);
        boolean membersKept = preview.membershipsEndedBefore() == null || (memberMonths != null
                && preview.membershipsEndedBefore().equals(previewedOn.minusMonths(memberMonths)));
        if (!bookingsKept || !membersKept) {
            throw new RetentionPreviewNotFoundException("A retention preview applies a period the board has changed since");
        }
    }

    private static @Nullable Instant cutoff(@Nullable Integer months, LocalDate today, ZoneId zone) {
        return months == null ? null : today.minusMonths(months).atStartOfDay(zone).toInstant();
    }
}
