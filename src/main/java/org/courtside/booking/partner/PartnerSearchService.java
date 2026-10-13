package org.courtside.booking.partner;

import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingParticipant;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.internal.BookingRuleGate;
import org.courtside.booking.internal.CardEligibilityPolicy;
import org.courtside.card.ParticipantCard;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.PartnerJoined;
import org.courtside.shared.SqlConstraintViolation;
import org.courtside.shared.TimeSlot;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class PartnerSearchService {

    private static final String ONE_PARTICIPATION_PER_PERSON = "booking_participant_unique_person";

    private final PartnerInvitationRows rows;
    private final BookingRepository bookings;
    private final EntityManager entityManager;
    private final CardEligibilityPolicy cardEligibility;
    private final BookingRuleGate ruleGate;
    private final UserAccountRepository accounts;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    // Publishing twice answers with the invitation that already stands.
    @Transactional
    public UUID publish(UUID bookingId, UUID accountId) {
        Booking booking = lockedOwn(bookingId, accountId);
        if (!isOpen(booking, clock.instant())) {
            throw PartnerPlaceUnavailableException.closed();
        }
        BookingParticipant marker = booking.getParticipants().stream()
                .filter(participant -> ParticipantCard.LOOKING_FOR_A_PARTNER.equals(participant.getCardId()))
                .findFirst()
                .orElseThrow(PartnerPlaceUnavailableException::none);
        return rows.forBooking(bookingId).orElseGet(() -> {
            UUID id = UUID.randomUUID();
            rows.insert(id, bookingId, marker.getId(), clock.instant());
            log.info("Account {} published the open place of booking {}", accountId, bookingId);
            return id;
        });
    }

    @Transactional
    public void withdraw(UUID bookingId, UUID accountId) {
        lockedOwn(bookingId, accountId);
        rows.deleteForBooking(bookingId);
    }

    @Transactional(readOnly = true)
    public List<OpenPlace> openPlaces(UUID accountId, UUID personId, Set<Role> roles) {
        if (!mayTakeAPlace(accountId, personId, roles)) {
            return List.of();
        }
        return rows.offeredBeyond(accountId, personId, ParticipantCard.LOOKING_FOR_A_PARTNER, clock.instant()).stream()
                .filter(candidate -> cardEligibility.admits(candidate.cardId(), roles))
                .map(candidate -> new OpenPlace(candidate.invitationId(), candidate.cardId(), candidate.courtIds(),
                        candidate.slot()))
                .toList();
    }

    // The booking row lock orders every acceptance, withdrawal and cancellation of the booking.
    @Transactional
    public UUID accept(UUID invitationId, UUID accountId, UUID personId, Set<Role> roles) {
        PartnerInvitationRows.Invitation invitation = rows.find(invitationId)
                .orElseThrow(PartnerInvitationNotFoundException::new);
        bookings.lockById(invitation.bookingId()).orElseThrow(PartnerInvitationNotFoundException::new);
        entityManager.clear();
        if (rows.find(invitationId).isEmpty() || !mayTakeAPlace(accountId, personId, roles)) {
            throw new PartnerInvitationNotFoundException();
        }
        Booking booking = bookings.findWithParticipantsById(invitation.bookingId())
                .filter(found -> isOpen(found, clock.instant()))
                .filter(found -> !accountId.equals(found.getBookedBy()))
                .filter(found -> found.getParticipants().stream()
                        .noneMatch(participant -> personId.equals(participant.getPersonId())))
                .filter(found -> cardEligibility.admits(found.getCardId(), roles))
                .orElseThrow(PartnerInvitationNotFoundException::new);
        if (!booking.fillOpenPlace(invitation.participantId(), personId)) {
            throw new PartnerInvitationNotFoundException();
        }
        try {
            bookings.saveAndFlush(booking);
        } catch (DataIntegrityViolationException failure) {
            if (SqlConstraintViolation.matches(failure, SqlConstraintViolation.UNIQUE_VIOLATION,
                    ONE_PARTICIPATION_PER_PERSON)) {
                throw new PartnerInvitationNotFoundException();
            }
            throw failure;
        }
        rows.delete(invitationId);
        events.publishEvent(new PartnerJoined(booking.getId(), personId));
        log.info("Account {} took the open place of booking {}", accountId, booking.getId());
        return booking.getId();
    }

    @Transactional(readOnly = true)
    public Map<UUID, PartnerSearchState> searchStatesOf(Collection<UUID> bookingIds) {
        return bookingIds.isEmpty() ? Map.of() : rows.searchStates(bookingIds, ParticipantCard.LOOKING_FOR_A_PARTNER,
                clock.instant());
    }

    @Transactional
    public void sweep() {
        int removed = rows.deleteClosed(ParticipantCard.LOOKING_FOR_A_PARTNER, clock.instant());
        if (removed > 0) {
            log.info("Removed {} open places nobody can take any more", removed);
        }
    }

    private Booking lockedOwn(UUID bookingId, UUID accountId) {
        bookings.lockById(bookingId).orElseThrow(() -> notYours(bookingId));
        entityManager.clear();
        return bookings.findWithParticipantsById(bookingId)
                .filter(booking -> booking.getBookedBy().equals(accountId))
                .orElseThrow(() -> notYours(bookingId));
    }

    private boolean mayTakeAPlace(UUID accountId, UUID personId, Set<Role> roles) {
        if (accountId == null || personId == null || roles == null) {
            return false;
        }
        Optional<UserAccount> account = accounts.findById(accountId);
        return account.filter(UserAccount::isEnabled)
                .filter(found -> personId.equals(found.getPerson().getId()))
                .isPresent()
                && ruleGate.bookingEligibilityFor(personId, roles).isEmpty();
    }

    private static boolean isOpen(Booking booking, Instant now) {
        return booking.getStatus() == BookingStatus.CONFIRMED && booking.getSeriesId() == null
                && booking.getAllocations().stream().map(CourtAllocation::getStartsAt).allMatch(now::isBefore);
    }

    private static BookingNotFoundException notYours(UUID bookingId) {
        return new BookingNotFoundException("No booking " + bookingId + " of this account");
    }

    // Nothing here names the holder, the booking or another player: the place is all that is offered.
    public record OpenPlace(UUID invitationId, UUID cardId, List<UUID> courtIds, TimeSlot slot) {
    }
}
