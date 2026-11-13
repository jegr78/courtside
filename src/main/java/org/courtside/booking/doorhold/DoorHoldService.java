package org.courtside.booking.doorhold;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingParticipant;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.doorhold.DoorHoldRows.Hold;
import org.courtside.booking.doorhold.DoorHoldRows.Window;
import org.courtside.booking.internal.BookingAccessControl;
import org.courtside.booking.internal.BookingExtension;
import org.courtside.booking.internal.BookingExtensionRefusedException;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.config.AccessPolicy;
import org.courtside.config.BookingGridCoordination;
import org.courtside.config.BookingGridSettings;
import org.courtside.facility.AccessPoint;
import org.courtside.facility.FacilityService;
import org.courtside.identity.Outsiders;
import org.courtside.identity.Person;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.BookingCancelled;
import org.courtside.shared.SeriesCancelled;
import org.courtside.shared.SeriesMoved;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Holds a booking's doors open while somebody on it is checked in: its booker, a named player or a manager. */
@Service
@RequiredArgsConstructor
@Transactional
public class DoorHoldService {

    private static final int EXTENSION_MINUTES = 30;
    private static final Duration SIGNAL_VALIDITY = Duration.ofMinutes(2);

    private final DoorHoldRows rows;
    private final BookingRepository bookings;
    private final BookingAccessControl accessControl;
    private final CardService cards;
    private final AccessPolicy accessPolicy;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final BookingExtension extension;
    private final BookingGridCoordination bookingGridCoordination;
    private final BookingGridSettings bookingGrid;
    private final FacilityService facility;
    private final Outsiders outsiders;
    private final UserAccountRepository accounts;

    public DoorHold start(UUID bookingId, UUID actor, Set<Role> actorRoles) {
        Booking booking = lockedBooking(bookingId);
        requireHoldAccess(booking, actor, actorRoles);
        if (!cards.requireCard(booking.getCardId()).isHoldsDoorsOpen()) {
            throw new DoorHoldNotOfferedException();
        }
        Window window = windowOf(booking);
        Instant now = clock.instant();
        if (booking.getStatus() != BookingStatus.CONFIRMED || now.isBefore(window.opensAt())
                || !now.isBefore(window.closesAt())) {
            throw new DoorHoldClosedException(lead().toMinutes());
        }
        Optional<Hold> running = rows.unendedSince(window);
        if (running.isPresent()) {
            if (running.get().heldBy() != null && running.get().heldBy().equals(actor)) {
                return toDoorHold(window, running, actor, extensible(actor, actorRoles));
            }
            throw new DoorHoldAlreadyRunningException();
        }
        UUID holdId = UUID.randomUUID();
        rows.start(holdId, bookingId, actor, now);
        events.publishEvent(new DoorHoldEvent.Started(bookingId, holdId));
        return toDoorHold(window, Optional.of(new Hold(holdId, bookingId, now, actor)), actor,
                extensible(actor, actorRoles));
    }

    public void end(UUID bookingId, UUID actor, Set<Role> actorRoles) {
        Booking booking = lockedBooking(bookingId);
        requireHoldAccess(booking, actor, actorRoles);
        Hold hold = running(booking).orElseThrow(DoorHoldNotRunningException::new);
        if (!actorRoles.contains(Role.ADMIN) && !actor.equals(hold.heldBy())) {
            throw new DoorHoldNotHolderException();
        }
        rows.end(hold.id(), actor, clock.instant());
        events.publishEvent(new DoorHoldEvent.Ended(bookingId, hold.id()));
    }

    /** Extends the booking whose doors {@code actor} holds open to {@code endsAt}, one extension step past its end. */
    public DoorHold extend(UUID bookingId, Instant endsAt, UUID actor, Set<Role> actorRoles) {
        bookingGridCoordination.lock();
        Booking booking = lockedBooking(bookingId);
        requireHoldAccess(booking, actor, actorRoles);
        if (!cards.requireCard(booking.getCardId()).isHoldsDoorsOpen()) {
            throw new DoorHoldNotOfferedException();
        }
        Hold hold = running(booking).orElseThrow(DoorHoldNotRunningException::new);
        if (!actor.equals(hold.heldBy())) {
            throw new DoorHoldNotHolderException();
        }
        Instant currentEnd = windowOf(booking).closesAt();
        if (!endsAt.equals(currentEnd)) {
            if (!endsAt.equals(currentEnd.plus(extensionStep()))) {
                throw BookingExtensionRefusedException.stale(currentEnd);
            }
            extension.extend(bookingId, endsAt, actor, actorRoles);
        }
        return toDoorHold(windowOf(lockedBooking(bookingId)), Optional.of(hold), actor, extensible(actor, actorRoles));
    }

    @EventListener
    public void on(BookingCancelled cancelled) {
        endAll(List.of(cancelled.bookingId()), cancelled.cancelledByAccountId());
    }

    @EventListener
    public void on(SeriesCancelled cancelled) {
        endAll(cancelled.bookingIds(), cancelled.cancelledByAccountId());
    }

    // A moved booking may keep a window the old hold began in, on doors that are no longer its own.
    @EventListener
    public void on(SeriesMoved moved) {
        endAll(moved.bookingIds(), moved.movedByAccountId());
    }

    private void endAll(List<UUID> bookingIds, UUID endedBy) {
        rows.endAll(bookingIds, endedBy, clock.instant())
                .forEach(hold -> events.publishEvent(new DoorHoldEvent.Ended(hold.bookingId(), hold.id())));
    }

    /** The door hold state of each booking whose card offers one, as {@code viewer} sees it. */
    @Transactional(readOnly = true)
    public Map<UUID, DoorHold> doorHoldsOf(Collection<Booking> candidates, UUID viewer) {
        Set<UUID> holdingCards = cards.allCards().stream().filter(BookingCard::isHoldsDoorsOpen)
                .map(BookingCard::getId).collect(Collectors.toSet());
        Map<UUID, Window> windows = candidates.stream()
                .filter(booking -> !booking.getAllocations().isEmpty())
                .filter(booking -> holdingCards.contains(booking.getCardId()))
                .collect(Collectors.toMap(Booking::getId, this::windowOf));
        Set<UUID> confirmed = candidates.stream().filter(booking -> booking.getStatus() == BookingStatus.CONFIRMED)
                .map(Booking::getId).collect(Collectors.toSet());
        Instant now = clock.instant();
        Map<UUID, Hold> held = rows.unendedSince(windows.values()).stream()
                .filter(hold -> confirmed.contains(hold.bookingId()))
                .filter(hold -> now.isBefore(windows.get(hold.bookingId()).closesAt()))
                .collect(Collectors.toMap(Hold::bookingId, Function.identity()));
        boolean extensible = !outsiders.isOutsiderAccount(viewer);
        return windows.values().stream().collect(Collectors.toMap(Window::bookingId,
                window -> toDoorHold(window, Optional.ofNullable(held.get(window.bookingId())), viewer, extensible)));
    }

    /** Every active access point and whether a running hold keeps it open, valid until {@code expiresAt}. */
    @Transactional(readOnly = true)
    public DoorSignals doorSignals() {
        Instant now = clock.instant();
        List<UUID> candidates = rows.unendedOnBookingsEndingAfter(now);
        List<Booking> held = candidates.isEmpty() ? List.of() : bookings.findAllByIdIn(candidates);
        Map<UUID, DoorHold> holds = doorHoldsOf(held, null);
        Set<UUID> heldCourts = held.stream()
                .filter(booking -> Optional.ofNullable(holds.get(booking.getId())).map(DoorHold::heldSince).isPresent())
                .flatMap(booking -> booking.getAllocations().stream().map(CourtAllocation::getCourtId))
                .collect(Collectors.toSet());
        List<DoorSignal> doors = facility.allAccessPoints().stream()
                .filter(AccessPoint::isActive)
                .sorted(Comparator.comparing(AccessPoint::getId))
                .map(accessPoint -> new DoorSignal(accessPoint.getId(),
                        accessPoint.isOpenToMembers() ? !heldCourts.isEmpty() : heldCourts.stream().anyMatch(accessPoint::serves)))
                .toList();
        return new DoorSignals(doors, now.plus(SIGNAL_VALIDITY));
    }

    public record DoorSignal(UUID accessPointId, boolean open) {
    }

    public record DoorSignals(List<DoorSignal> doors, Instant expiresAt) {
    }

    private Optional<Hold> running(Booking booking) {
        Window window = windowOf(booking);
        if (booking.getStatus() != BookingStatus.CONFIRMED || !clock.instant().isBefore(window.closesAt())) {
            return Optional.empty();
        }
        return rows.unendedSince(window);
    }

    private Booking lockedBooking(UUID bookingId) {
        bookings.lockById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
        return bookings.findWithAllocationsById(bookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + bookingId));
    }

    private Window windowOf(Booking booking) {
        Instant startsAt = booking.getAllocations().stream().map(CourtAllocation::getStartsAt)
                .min(Comparator.naturalOrder())
                .orElseThrow(() -> new IllegalStateException("A booking without allocations has no door window"));
        Instant endsAt = booking.getAllocations().stream().map(CourtAllocation::getEndsAt)
                .max(Comparator.naturalOrder()).orElseThrow();
        return new Window(booking.getId(), startsAt.minus(lead()), endsAt);
    }

    private Duration lead() {
        return accessPolicy.accessLead().toDuration();
    }

    private DoorHold toDoorHold(Window window, Optional<Hold> hold, UUID viewer, boolean extensible) {
        boolean heldByMe = hold.map(Hold::heldBy).filter(heldBy -> heldBy.equals(viewer)).isPresent();
        return new DoorHold(window.opensAt(), window.closesAt(), hold.map(Hold::heldAt).orElse(null), heldByMe,
                heldByMe && extensible ? window.closesAt().plus(extensionStep()) : null);
    }

    // An outsider may hold the doors of their own booking open, but every extension refuses them.
    private boolean extensible(UUID actor, Set<Role> actorRoles) {
        return !outsiders.isOutsider(actor, actorRoles);
    }

    private void requireHoldAccess(Booking booking, UUID actor, Set<Role> actorRoles) {
        Optional<UUID> person = accounts.findById(actor).map(UserAccount::getPerson).map(Person::getId);
        boolean namedPlayer = person.isPresent() && !outsiders.isOutsider(actor, actorRoles)
                && booking.getParticipants().stream().map(BookingParticipant::getPersonId).anyMatch(person.get()::equals);
        if (!namedPlayer) {
            accessControl.requireManagementAccess(booking, actor, actorRoles);
        }
    }

    // The smallest whole number of booking slots that reaches half an hour, so the grid rule accepts it.
    private Duration extensionStep() {
        int slot = bookingGrid.slotDuration().minutes();
        return Duration.ofMinutes((long) Math.ceilDiv(EXTENSION_MINUTES, slot) * slot);
    }

    public record DoorHold(Instant opensAt, Instant closesAt, Instant heldSince, boolean heldByMe,
                           Instant extensionEndsAt) {
    }
}
