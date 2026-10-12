package org.courtside.booking.waitlist;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.booking.BookingRuleCheck;
import org.courtside.booking.internal.BookingRuleGate;
import org.courtside.booking.internal.CourtReservations;
import org.courtside.booking.internal.CourtReservedException;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.BookingGridCoordination;
import org.courtside.config.WaitlistOfferPolicy;
import org.courtside.facility.FacilityService;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.TimeSlot;
import org.courtside.shared.WaitlistOffered;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
class WaitlistQueue implements CourtReservations {

    private final WaitlistRows rows;
    private final BookingGridCoordination grid;
    private final WaitlistOfferPolicy policy;
    private final UserAccountRepository accounts;
    private final CardService cards;
    private final FacilityService facility;
    private final BookingRuleGate ruleGate;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    // An offer past its deadline still holds the court until the sweep passes it on, so nobody
    // outside the queue can take it in between.
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void requireUnreserved(List<UUID> courtIds, TimeSlot slot, UUID accountId) {
        if (!rows.offeredCourts(courtIds, slot, accountId).isEmpty()) {
            throw new CourtReservedException();
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<UUID> reservedCourts(List<UUID> courtIds, TimeSlot slot, UUID accountId) {
        return rows.offeredCourts(courtIds, slot, accountId);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void booked(UUID accountId, UUID bookingId, List<UUID> courtIds, TimeSlot slot) {
        if (accountId == null) {
            return;
        }
        rows.closeOpenOverlapping(accountId, courtIds, slot, bookingId, clock.instant()).stream()
                .filter(entry -> entry.state() == WaitlistState.OFFERED)
                .forEach(entry -> offerFreeQueues(List.of(entry.courtId()), entry.slot()));
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void released(List<UUID> courtIds, TimeSlot slot) {
        offerFreeQueues(courtIds, slot);
    }

    // Passes on what fell due, closes what started and forgets what ended, then offers every free
    // slot a queue waits for, which also catches a release no hook announced.
    @Transactional
    public void sweep() {
        grid.lock();
        Instant now = clock.instant();
        int expired = rows.expireDue(now);
        int ended = rows.endStarted(now);
        int deleted = rows.deleteEnded(now);
        int offered = offerFreeQueues(null, null);
        if (expired + ended + deleted + offered > 0) {
            log.info("Waitlist sweep: {} offers expired, {} entries ended, {} removed, {} offers made",
                    expired, ended, deleted, offered);
        }
    }

    int offerFreeQueues(Collection<UUID> courtIds, TimeSlot window) {
        Instant now = clock.instant();
        int offered = 0;
        for (WaitlistRows.Queue queue : rows.freeQueues(courtIds, window, now)) {
            if (offerNext(queue, now)) {
                offered += 1;
            }
        }
        return offered;
    }

    private boolean offerNext(WaitlistRows.Queue queue, Instant now) {
        if (!rows.offeredCourts(List.of(queue.courtId()), queue.slot(), null).isEmpty()) {
            return false;
        }
        Instant deadline = now.plus(policy.offerWindow().toDuration());
        Instant expiresAt = deadline.isBefore(queue.slot().start()) ? deadline : queue.slot().start();
        for (WaitlistEntry entry : rows.lockWaiting(queue)) {
            if (eligible(entry)) {
                rows.offer(entry.id(), now, expiresAt);
                events.publishEvent(new WaitlistOffered(entry.id(), entry.accountId()));
                return true;
            }
            rows.close(entry.id(), WaitlistState.SKIPPED, now);
            log.info("Skipped waitlist entry {} of account {}: no longer eligible", entry.id(), entry.accountId());
        }
        return false;
    }

    // A disabled account cannot sign in to see an offer, so it would only hold the court for nothing.
    private boolean eligible(WaitlistEntry entry) {
        Optional<UserAccount> account = accounts.findById(entry.accountId()).filter(UserAccount::isEnabled);
        if (account.isEmpty()) {
            return false;
        }
        Set<Role> roles = account.get().getRoles();
        Optional<BookingCard> card = cards.findCard(entry.cardId()).filter(BookingCard::isActive);
        if (card.isEmpty() || !(roles.contains(Role.ADMIN) || card.get().permits(roles))) {
            return false;
        }
        if (!facility.findUnbookableCourts(List.of(entry.courtId())).isEmpty()) {
            return false;
        }
        return ruleGate.violationsFor(new BookingRuleCheck(List.of(entry.courtId()), entry.cardId(), entry.slot(),
                entry.accountId(), account.get().getPerson().getId(), roles)).isEmpty();
    }
}
