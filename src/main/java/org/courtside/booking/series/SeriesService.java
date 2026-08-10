package org.courtside.booking.series;

import org.courtside.booking.Booking;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.internal.BookingNotOwnedException;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingRuleCheck;
import org.courtside.booking.internal.BookingRuleGate;
import org.courtside.booking.internal.CardNotBookableException;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.internal.CardRoleRequiredException;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.internal.ParticipantCardCapacity;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.facility.FacilityService;
import org.courtside.identity.Role;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class SeriesService {

    private static final String OVERLAP_CONSTRAINT = "court_allocation_no_overlap";

    private final SeriesSchedule schedule;
    private final CourtAllocationRepository allocations;
    private final BookingService bookings;
    private final BookingSeriesRepository seriesRepository;
    private final BookingRepository bookingRepository;
    private final FacilityService facility;
    private final CardService cards;
    private final BookingRuleGate ruleGate;
    private final ParticipantCardCapacity participantCardCapacity;
    private final Clock clock;
    private final ZoneId zone;

    public SeriesService(SeriesSchedule schedule,
                         CourtAllocationRepository allocations,
                         BookingService bookings,
                         BookingSeriesRepository seriesRepository,
                         BookingRepository bookingRepository,
                         FacilityService facility,
                         CardService cards,
                         BookingRuleGate ruleGate,
                         ParticipantCardCapacity participantCardCapacity,
                         Clock clock,
                         @Value("${courtside.booking.time-zone}") String zone) {
        this.schedule = schedule;
        this.allocations = allocations;
        this.bookings = bookings;
        this.seriesRepository = seriesRepository;
        this.bookingRepository = bookingRepository;
        this.facility = facility;
        this.cards = cards;
        this.ruleGate = ruleGate;
        this.participantCardCapacity = participantCardCapacity;
        this.clock = clock;
        this.zone = ZoneId.of(zone);
    }

    @Transactional(readOnly = true)
    public SeriesPreview preview(SeriesRule rule, UUID bookedBy, UUID bookedByPersonId,
                                 Set<Role> callerRoles) {
        requireBookableCard(rule.cardId());
        facility.requireBookableCourts(rule.courtIds());
        SeriesSchedule.Expansion expansion = expandWithinLimit(rule);
        List<SeriesPreview.Occurrence> occurrences = expansion.slots().stream()
                .map(slot -> new SeriesPreview.Occurrence(slot, blockedCourts(rule, slot),
                        ruleGate.violationsFor(new BookingRuleCheck(rule.courtIds(), rule.cardId(),
                                slot, bookedBy, bookedByPersonId, callerRoles))))
                .toList();
        return new SeriesPreview(occurrences, expansion.truncatedByHorizon(), expansion.horizonLimit());
    }

    public SeriesCreationResult create(SeriesRule rule, List<Instant> confirmedStarts,
                                       UUID bookedBy, UUID bookedByPersonId,
                                       Set<Role> callerRoles, String note) {
        if (confirmedStarts.isEmpty()) {
            return new SeriesCreationResult(null, List.of(), List.of());
        }
        requireOfferedBySchedule(rule, confirmedStarts);
        facility.requireBookableCourts(rule.courtIds());
        requireBookableCard(rule.cardId(), callerRoles);

        BookingSeries series = seriesRepository.saveAndFlush(
                new BookingSeries(rule, bookedBy, note, clock.instant()));

        List<UUID> created = new ArrayList<>();
        List<Instant> skipped = new ArrayList<>();

        try {
            for (Instant start : confirmedStarts) {
                TimeSlot slot = new TimeSlot(start, start.plus(rule.durationMinutes(), ChronoUnit.MINUTES));
                try {
                    UUID bookingId = bookings.create(new CreateBookingCommand(
                            rule.courtIds(), rule.cardId(), slot,
                            bookedBy, bookedByPersonId, callerRoles, note, List.of(), series.getId()));
                    created.add(bookingId);
                } catch (CourtUnavailableException | BookingRulesViolatedException e) {
                    skipped.add(start);
                }
            }
        } catch (RuntimeException e) {
            if (created.isEmpty()) {
                seriesRepository.delete(series);
            }
            throw e;
        }
        if (created.isEmpty()) {
            seriesRepository.delete(series);
            return new SeriesCreationResult(null, created, skipped);
        }
        return new SeriesCreationResult(series.getId(), created, skipped);
    }

    private BookingCard requireBookableCard(UUID cardId) {
        BookingCard card = cards.findCard(cardId)
                .orElseThrow(() -> new CardNotBookableException(
                        "card.unknown", Map.of("field", "cardId")));
        if (!card.isActive()) {
            throw new CardNotBookableException("card.inactive", Map.of("field", "cardId"));
        }
        requireCardDoesNotTrackPlayers(card);
        return card;
    }

    private void requireBookableCard(UUID cardId, Set<Role> callerRoles) {
        BookingCard card = requireBookableCard(cardId);
        if (callerRoles.contains(Role.ADMIN)) {
            return;
        }
        if (!card.permits(callerRoles)) {
            throw new CardRoleRequiredException(
                    "Card %s requires role %s".formatted(card.getId(), card.getRequiredRole()));
        }
    }

    private void requireCardDoesNotTrackPlayers(BookingCard card) {
        if (card.tracksPlayers()) {
            throw new ParticipantsInvalidException("booking.series.cardTracksPlayers",
                    Map.of("cardLabel", card.getLabel()));
        }
    }

    @Transactional
    public int cancel(UUID seriesId, UUID fromBookingId, CancelScope scope,
                      UUID cancelledBy, Set<Role> cancellerRoles) {
        requireSeriesAndBooking(seriesId, fromBookingId);

        List<Booking> affected = affectedBookings(seriesId, fromBookingId, scope);
        affected.forEach(booking ->
                bookings.cancel(booking.getId(), cancelledBy, cancellerRoles));
        return affected.size();
    }

    @Transactional(readOnly = true)
    public MovePreview previewMove(MoveRequest request, UUID movedBy, Set<Role> callerRoles) {
        requireSeriesAndBooking(request.seriesId(), request.fromBookingId());

        List<Booking> affected =
                affectedBookings(request.seriesId(), request.fromBookingId(), request.scope());
        requireOwnerOrAdmin(affected, movedBy, callerRoles);

        List<UUID> movingIds = affected.stream().map(Booking::getId).toList();
        List<PlannedMove> planned = affected.stream()
                .map(booking -> planMove(booking, request))
                .toList();
        List<ParticipantCardCapacity.Target> targets = participantTargets(planned);

        List<MovePreview.Move> moves = planned.stream()
                .map(move -> toPreviewMove(move, planned, movingIds, targets))
                .toList();

        return new MovePreview(moves);
    }

    // Without it nothing persists at all; with it, a mid-flush constraint failure undoes every move.
    @Transactional
    public int move(MoveRequest request, UUID movedBy, Set<Role> callerRoles) {
        MovePreview preview = previewMove(request, movedBy, callerRoles);

        List<UUID> blocked = preview.moves().stream()
                .filter(move -> !move.blockedCourtIds().isEmpty())
                .map(MovePreview.Move::bookingId)
                .toList();
        if (!blocked.isEmpty()) {
            throw new SeriesMoveConflictException(blocked);
        }

        List<MoveExecution> executions = preview.moves().stream()
                .map(move -> planExecution(move, request))
                .toList();
        List<ParticipantCardCapacity.Target> targets = executions.stream()
                .map(execution -> new ParticipantCardCapacity.Target(
                        execution.booking().getId(), execution.booking().getParticipants(), execution.slot()))
                .toList();
        List<UUID> movingIds = movingBookingIds(executions);

        executions.forEach(execution -> {
            facility.requireBookableCourts(execution.courtIds());
            requireNoNonOverridableViolations(execution);
            participantCardCapacity.requireAvailableForParticipants(
                    execution.booking().getParticipants(), execution.slot(), execution.booking().getId(),
                    movingIds, targets);
        });

        executions.forEach(execution -> execution.booking().clearAllocations());
        bookingRepository.flush();

        executions.forEach(execution -> execution.courtIds().forEach(
                courtId -> execution.booking().allocate(courtId, execution.slot())));
        try {
            bookingRepository.flush();
        } catch (DataIntegrityViolationException e) {
            if (isOverlap(e)) {
                throw new CourtUnavailableException(
                        "One of the requested courts is already occupied for that time", e);
            }
            throw e;
        }
        return executions.size();
    }

    private record MoveExecution(Booking booking, List<UUID> courtIds, TimeSlot slot) {
    }

    private List<UUID> movingBookingIds(List<MoveExecution> executions) {
        return executions.stream().map(execution -> execution.booking().getId()).toList();
    }

    private MoveExecution planExecution(MovePreview.Move move, MoveRequest request) {
        Booking booking = bookingRepository.findWithAllocationsById(move.bookingId())
                .orElseThrow(() -> new BookingNotFoundException(
                        "No booking with id " + move.bookingId()));
        List<UUID> courtIds = request.newCourtIds() == null
                ? currentCourtsOf(booking)
                : request.newCourtIds();
        return new MoveExecution(booking, courtIds, move.to());
    }

    private void requireOwnerOrAdmin(List<Booking> affected, UUID movedBy, Set<Role> callerRoles) {
        if (callerRoles.contains(Role.ADMIN)) {
            return;
        }
        affected.stream()
                .filter(booking -> !movedBy.equals(booking.getBookedBy()))
                .findFirst()
                .ifPresent(booking -> {
                    throw new BookingNotOwnedException(
                            "Account %s may not move booking %s".formatted(movedBy, booking.getId()));
                });
    }

    private void requireNoNonOverridableViolations(MoveExecution execution) {
        ruleGate.requireNoNonOverridableViolations(
                execution.courtIds(), execution.booking().getCardId(), execution.slot(),
                execution.booking().getBookedBy());
    }

    private boolean isOverlap(DataIntegrityViolationException e) {
        String message = e.getMostSpecificCause().getMessage();
        return message != null && message.contains(OVERLAP_CONSTRAINT);
    }

    private record PlannedMove(UUID bookingId, UUID cardId, UUID bookedBy,
                               TimeSlot from, TimeSlot to, List<UUID> courts) {
    }

    private PlannedMove planMove(Booking booking, MoveRequest request) {
        TimeSlot from = currentSlotOf(booking);
        TimeSlot to = targetSlot(from, request);
        List<UUID> courts = request.newCourtIds() == null
                ? currentCourtsOf(booking)
                : request.newCourtIds();
        return new PlannedMove(booking.getId(), booking.getCardId(), booking.getBookedBy(),
                from, to, courts);
    }

    private MovePreview.Move toPreviewMove(PlannedMove move, List<PlannedMove> planned,
                                           List<UUID> movingIds,
                                           List<ParticipantCardCapacity.Target> targets) {
        Set<UUID> blocked = new LinkedHashSet<>(allocations.findOccupiedCourtsExcluding(
                move.courts(), move.to().start(), move.to().end(), movingIds));
        blocked.addAll(conflictingCourts(move, planned));
        Booking booking = bookingRepository.findWithParticipantsById(move.bookingId()).orElseThrow();
        List<RuleViolation> violations = new ArrayList<>(
                ruleGate.nonOverridableViolationsFor(
                        move.courts(), move.cardId(), move.to(), move.bookedBy()));
        violations.addAll(participantCardCapacity.violationsFor(
                booking.getParticipants(), move.to(), move.bookingId(), movingIds, targets));
        return new MovePreview.Move(move.bookingId(), move.from(), move.to(), List.copyOf(blocked),
                facility.findUnbookableCourts(move.courts()),
                violations);
    }

    private List<ParticipantCardCapacity.Target> participantTargets(List<PlannedMove> planned) {
        return planned.stream()
                .map(move -> new ParticipantCardCapacity.Target(move.bookingId(),
                        bookingRepository.findWithParticipantsById(move.bookingId()).orElseThrow()
                                .getParticipants(), move.to()))
                .toList();
    }

    private List<UUID> conflictingCourts(PlannedMove move, List<PlannedMove> planned) {
        return planned.stream()
                .filter(other -> !other.bookingId().equals(move.bookingId()))
                .filter(other -> move.to().overlaps(other.to()))
                .flatMap(other -> move.courts().stream().filter(other.courts()::contains))
                .distinct()
                .toList();
    }

    private void requireSeriesAndBooking(UUID seriesId, UUID fromBookingId) {
        if (!seriesRepository.existsById(seriesId)) {
            throw new SeriesNotFoundException("No booking series with id " + seriesId);
        }
        if (!bookingRepository.existsByIdAndSeriesId(fromBookingId, seriesId)) {
            throw new SeriesRequestInvalidException("booking.series.bookingNotInSeries",
                    Map.of("field", "fromBookingId"));
        }
    }

    private List<Booking> affectedBookings(UUID seriesId, UUID fromBookingId, CancelScope scope) {
        List<Booking> confirmed = bookingRepository.findConfirmedBySeriesOrderedByStart(seriesId);
        return switch (scope) {
            case WHOLE_SERIES -> confirmed;
            case THIS -> confirmed.stream()
                    .filter(booking -> booking.getId().equals(fromBookingId))
                    .toList();
            case THIS_AND_FOLLOWING -> tailFrom(confirmed, fromBookingId);
        };
    }

    private List<Booking> tailFrom(List<Booking> confirmed, UUID fromBookingId) {
        int index = confirmed.stream()
                .map(Booking::getId)
                .toList()
                .indexOf(fromBookingId);
        return index < 0 ? List.of() : confirmed.subList(index, confirmed.size());
    }

    private TimeSlot currentSlotOf(Booking booking) {
        Instant start = booking.getAllocations().stream()
                .map(CourtAllocation::getStartsAt).min(Instant::compareTo).orElseThrow();
        Instant end = booking.getAllocations().stream()
                .map(CourtAllocation::getEndsAt).max(Instant::compareTo).orElseThrow();
        return new TimeSlot(start, end);
    }

    private List<UUID> currentCourtsOf(Booking booking) {
        return booking.getAllocations().stream().map(CourtAllocation::getCourtId).toList();
    }

    private TimeSlot targetSlot(TimeSlot from, MoveRequest request) {
        ZonedDateTime current = from.start().atZone(zone);
        LocalTime startTime = request.newStartTime() == null
                ? current.toLocalTime()
                : request.newStartTime();
        int minutes = request.newDurationMinutes() == null
                ? (int) Duration.between(from.start(), from.end()).toMinutes()
                : request.newDurationMinutes();

        ZonedDateTime start = current.toLocalDate().atTime(startTime).atZone(zone);
        return new TimeSlot(start.toInstant(), start.plusMinutes(minutes).toInstant());
    }

    private SeriesSchedule.Expansion expandWithinLimit(SeriesRule rule) {
        SeriesSchedule.Expansion expansion = schedule.expand(rule);
        if (expansion.slots().size() > SeriesRule.MAX_OCCURRENCES) {
            throw new SeriesRequestInvalidException("booking.series.tooManyOccurrences",
                    Map.of("limit", SeriesRule.MAX_OCCURRENCES,
                           "requested", expansion.slots().size()));
        }
        return expansion;
    }

    private void requireOfferedBySchedule(SeriesRule rule, List<Instant> confirmedStarts) {
        Set<Instant> offered = expandWithinLimit(rule).slots().stream()
                .map(TimeSlot::start)
                .collect(Collectors.toSet());
        if (!offered.containsAll(confirmedStarts)) {
            throw new SeriesRequestInvalidException("booking.series.startNotOffered",
                    Map.of("field", "confirmedStarts"));
        }
        if (Set.copyOf(confirmedStarts).size() != confirmedStarts.size()) {
            throw new SeriesRequestInvalidException("booking.series.duplicateStart",
                    Map.of("field", "confirmedStarts"));
        }
    }

    private List<UUID> blockedCourts(SeriesRule rule, TimeSlot slot) {
        return allocations.findOccupiedCourts(rule.courtIds(), slot.start(), slot.end());
    }
}
