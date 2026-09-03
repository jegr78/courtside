package org.courtside.booking.series;

import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingRuleCheck;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CourtAllocation;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.internal.BookingAccessControl;
import org.courtside.booking.internal.BookingNotFoundException;
import org.courtside.booking.internal.BookingRuleGate;
import org.courtside.booking.internal.CardEligibilityPolicy;
import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.booking.internal.ParticipantCardCapacity;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.card.BookingCard;
import org.courtside.config.BookingGridCoordination;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.FacilityService;
import org.courtside.identity.Role;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SeriesService {

    private static final String OVERLAP_CONSTRAINT = "court_allocation_no_overlap";

    private final SeriesSchedule schedule;
    private final CourtAllocationRepository allocations;
    private final BookingService bookings;
    private final BookingSeriesRepository seriesRepository;
    private final BookingRepository bookingRepository;
    private final FacilityService facility;
    private final CardEligibilityPolicy cardEligibility;
    private final BookingRuleGate ruleGate;
    private final BookingAccessControl accessControl;
    private final ParticipantCardCapacity participantCardCapacity;
    private final Clock clock;
    private final ClubTimeZone timeZone;
    private final BookingGridCoordination bookingGridCoordination;
    private final EntityManager entityManager;

    public SeriesService(SeriesSchedule schedule,
                         CourtAllocationRepository allocations,
                         BookingService bookings,
                         BookingSeriesRepository seriesRepository,
                         BookingRepository bookingRepository,
                         FacilityService facility,
                         CardEligibilityPolicy cardEligibility,
                         BookingRuleGate ruleGate,
                         BookingAccessControl accessControl,
                         ParticipantCardCapacity participantCardCapacity,
                         Clock clock,
                         BookingGridCoordination bookingGridCoordination,
                         ClubTimeZone timeZone,
                         EntityManager entityManager) {
        this.schedule = schedule;
        this.allocations = allocations;
        this.bookings = bookings;
        this.seriesRepository = seriesRepository;
        this.bookingRepository = bookingRepository;
        this.facility = facility;
        this.cardEligibility = cardEligibility;
        this.ruleGate = ruleGate;
        this.accessControl = accessControl;
        this.participantCardCapacity = participantCardCapacity;
        this.clock = clock;
        this.bookingGridCoordination = bookingGridCoordination;
        this.timeZone = timeZone;
        this.entityManager = entityManager;
    }

    @Transactional(readOnly = true)
    public SeriesPreview preview(SeriesRule rule, UUID bookedBy, UUID bookedByPersonId,
                                 Set<Role> callerRoles) {
        BookingCard card = cardEligibility.requireActive(rule.cardId());
        requireCardDoesNotTrackPlayers(card);
        facility.requireBookableCourts(rule.courtIds());
        SeriesSchedule.Expansion expansion = expandWithinLimit(rule);
        List<BookingRuleCheck> checks = expansion.slots().stream()
                .map(slot -> new BookingRuleCheck(rule.courtIds(), rule.cardId(), slot,
                        bookedBy, bookedByPersonId, callerRoles))
                .toList();
        List<List<RuleViolation>> violations = ruleGate.violationsFor(checks);
        List<SeriesPreview.Occurrence> occurrences = IntStream.range(0, expansion.slots().size())
                .mapToObj(index -> new SeriesPreview.Occurrence(
                        expansion.slots().get(index), blockedCourts(rule, expansion.slots().get(index)),
                        violations.get(index)))
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
        BookingCard card = cardEligibility.requireEligible(rule.cardId(), callerRoles);
        requireCardDoesNotTrackPlayers(card);

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

    private void requireCardDoesNotTrackPlayers(BookingCard card) {
        if (card.tracksPlayers()) {
            throw new ParticipantsInvalidException("booking.series.cardTracksPlayers",
                    Map.of("cardLabel", card.getLabel()));
        }
    }

    @Transactional
    public int cancel(UUID seriesId, UUID fromBookingId, CancelScope scope,
                      UUID cancelledBy, Set<Role> cancellerRoles) {
        requireManagementAccessTo(seriesId, fromBookingId, cancelledBy, cancellerRoles);
        lockSeries(seriesId);
        bookingRepository.lockBySeriesId(seriesId);
        discardPreLockState();
        requireManagementAccessTo(seriesId, fromBookingId, cancelledBy, cancellerRoles);

        List<Booking> affected = affectedBookings(seriesId, fromBookingId, scope);
        affected.forEach(booking ->
                bookings.cancel(booking.getId(), cancelledBy, cancellerRoles));
        return affected.size();
    }

    @Transactional(readOnly = true)
    public MovePreview previewMove(MoveRequest request, UUID movedBy, Set<Role> callerRoles) {
        return previewMove(request, movedBy, callerRoles, true);
    }

    private MovePreview previewMove(MoveRequest request, UUID movedBy, Set<Role> callerRoles,
                                    boolean includeViolations) {
        requireManagementAccessTo(request.seriesId(), request.fromBookingId(), movedBy, callerRoles);

        List<Booking> affected =
                affectedBookings(request.seriesId(), request.fromBookingId(), request.scope());
        affected.forEach(booking ->
                accessControl.requireManagementAccess(booking, movedBy, callerRoles));

        List<UUID> movingIds = affected.stream().map(Booking::getId).toList();
        List<PlannedMove> planned = affected.stream()
                .map(booking -> planMove(booking, request))
                .toList();
        List<ParticipantCardCapacity.Target> targets = participantTargets(planned);

        List<List<RuleViolation>> ruleViolations = includeViolations
                ? moveRuleViolations(planned, callerRoles)
                : planned.stream().map(ignored -> List.<RuleViolation>of()).toList();
        List<MovePreview.Move> moves = IntStream.range(0, planned.size())
                .mapToObj(index -> toPreviewMove(
                        planned.get(index), planned, movingIds, targets, ruleViolations.get(index)))
                .toList();

        return new MovePreview(moves);
    }

    @Transactional
    public int move(MoveRequest request, UUID movedBy, Set<Role> callerRoles) {
        requireManagementAccessTo(request.seriesId(), request.fromBookingId(), movedBy, callerRoles);
        bookingGridCoordination.lock();
        lockSeries(request.seriesId());
        // A cancellation locks the booking row it writes, so the move has to hold those rows too:
        // it rewrites every column of them and would otherwise flush over a cancellation it never saw.
        bookingRepository.lockBySeriesId(request.seriesId());
        discardPreLockState();
        // Rule evaluation is omitted from this internal preview and happens once, authoritatively,
        // below. Caching its membership input across both phases could conceal a concurrent change.
        MovePreview preview = previewMove(request, movedBy, callerRoles, false);

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
        executions.forEach(execution -> facility.requireBookableCourts(execution.courtIds()));

        Map<UUID, Optional<UUID>> owners = new HashMap<>();
        List<List<RuleViolation>> ruleViolations = ruleGate.moveViolationsFor(
                executions.stream().map(execution -> ownerCheck(
                        execution.courtIds(), execution.booking().getCardId(),
                        execution.slot(), execution.booking().getBookedBy(), callerRoles, owners))
                        .toList());
        IntStream.range(0, executions.size()).forEach(index -> {
            MoveExecution execution = executions.get(index);
            requireNoViolations(ruleViolations.get(index));
            participantCardCapacity.requireAvailableForParticipants(
                    execution.booking().getParticipants(), execution.slot(), execution.booking().getId(),
                    movingIds, targets);
        });

        executions.forEach(execution -> execution.booking().clearAllocations());
        bookingRepository.flush();

        executions.forEach(execution -> execution.courtIds().forEach(
                courtId -> execution.booking().allocate(courtId, execution.slot())));
        executions.forEach(execution -> execution.booking().recordMove(movedBy, clock.instant()));
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
                                           List<ParticipantCardCapacity.Target> targets,
                                           List<RuleViolation> ruleViolations) {
        Set<UUID> blocked = new LinkedHashSet<>(allocations.findOccupiedCourtsExcluding(
                move.courts(), move.to().start(), move.to().end(), movingIds));
        blocked.addAll(conflictingCourts(move, planned));
        Booking booking = bookingRepository.findWithParticipantsById(move.bookingId()).orElseThrow();
        List<RuleViolation> violations = new ArrayList<>(ruleViolations);
        violations.addAll(participantCardCapacity.violationsFor(
                booking.getParticipants(), move.to(), move.bookingId(), movingIds, targets));
        return new MovePreview.Move(move.bookingId(), move.from(), move.to(), List.copyOf(blocked),
                facility.findUnbookableCourts(move.courts()),
                violations);
    }

    // The person measured is the one holding the booking, not the one moving it; the roles are the
    // mover's, because the override is a property of who is acting. One series, one owner, one read.
    private BookingRuleCheck ownerCheck(List<UUID> courtIds, UUID cardId, TimeSlot slot,
                                        UUID bookedBy, Set<Role> callerRoles,
                                        Map<UUID, Optional<UUID>> owners) {
        UUID bookedByPersonId = owners
                .computeIfAbsent(bookedBy, account -> Optional.ofNullable(ruleGate.personBehind(account)))
                .orElse(null);
        return new BookingRuleCheck(courtIds, cardId, slot, bookedBy, bookedByPersonId, callerRoles);
    }

    private void requireNoViolations(List<RuleViolation> violations) {
        if (!violations.isEmpty()) {
            throw new BookingRulesViolatedException(violations);
        }
    }

    private List<List<RuleViolation>> moveRuleViolations(List<PlannedMove> planned,
                                                         Set<Role> callerRoles) {
        Map<UUID, Optional<UUID>> owners = new HashMap<>();
        return ruleGate.moveViolationsFor(planned.stream()
                .map(move -> ownerCheck(move.courts(), move.cardId(), move.to(), move.bookedBy(),
                        callerRoles, owners))
                .toList());
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

    // A series the caller names is answered the same way whether it does not exist or simply does
    // not hold this booking, so no series id is confirmable through a booking somebody else's.
    private void requireBookingInSeries(UUID seriesId, UUID fromBookingId) {
        if (!bookingRepository.existsByIdAndSeriesId(fromBookingId, seriesId)) {
            throw new SeriesRequestInvalidException("booking.series.bookingNotInSeries",
                    Map.of("field", "fromBookingId"));
        }
    }

    private void lockSeries(UUID seriesId) {
        seriesRepository.findForUpdateById(seriesId)
                .orElseThrow(() -> new SeriesNotFoundException("No booking series with id " + seriesId));
    }

    private void discardPreLockState() {
        entityManager.clear();
    }

    private void requireManagementAccessTo(UUID seriesId, UUID fromBookingId,
                                           UUID actor, Set<Role> actorRoles) {
        Booking from = bookingRepository.findWithAllocationsById(fromBookingId)
                .orElseThrow(() -> new BookingNotFoundException("No booking with id " + fromBookingId));
        accessControl.requireManagementAccess(from, actor, actorRoles);
        requireBookingInSeries(seriesId, fromBookingId);
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
        ZonedDateTime current = from.start().atZone(timeZone.zoneId());
        LocalTime startTime = request.newStartTime() == null
                ? current.toLocalTime()
                : request.newStartTime();
        int minutes = request.newDurationMinutes() == null
                ? (int) Duration.between(from.start(), from.end()).toMinutes()
                : request.newDurationMinutes();

        ZonedDateTime start = current.toLocalDate().atTime(startTime).atZone(timeZone.zoneId());
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
