package org.courtside.facility;

import org.courtside.facility.internal.CourtNumberTakenException;
import org.courtside.facility.internal.CourtRepository;
import org.courtside.facility.internal.OpeningHoursRepository;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.InvalidOpeningWindowException;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.SqlConstraintViolation;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.BookingGridCoordination;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FacilityService {

    private static final String UNIQUE_NUMBER_CONSTRAINT = "court_unique_number";

    private final CourtRepository courts;
    private final OpeningHoursRepository openingHours;
    private final BookingGridSettings bookingGridSettings;
    private final BookingGridCoordination bookingGridCoordination;
    private final ApplicationEventPublisher events;

    public List<Court> activeCourts() {
        return courts.findByActiveTrueOrderByNumberAsc();
    }

    public List<Court> allCourts() {
        return courts.findAllByOrderByNumberAsc();
    }

    public Optional<Court> findCourt(UUID courtId) {
        return courts.findById(courtId);
    }

    @Transactional
    public Court createCourt(int number, String name) {
        Court court = saveOrRejectTakenNumber(new Court(number, name));
        events.publishEvent(new FacilityEvent.CourtAdded(court.getId(), court.getNumber()));
        return court;
    }

    @Transactional
    public Court changeCourt(UUID courtId, int number, String name) {
        Court court = requireCourt(courtId);
        String previousName = court.getName();
        boolean numberChanged = court.getNumber() != number;
        court.changeTo(number, name);
        List<String> changedFields = Objects.equals(previousName, court.getName())
                ? List.of() : List.of("name");
        Court saved = saveOrRejectTakenNumber(court);
        if (numberChanged || !changedFields.isEmpty()) {
            events.publishEvent(
                    new FacilityEvent.CourtChanged(saved.getId(), saved.getNumber(), changedFields));
        }
        return saved;
    }

    @Transactional
    public Court setCourtActive(UUID courtId, boolean active) {
        Court court = requireCourt(courtId);
        if (court.isActive() == active) {
            return court;
        }
        if (active) {
            court.activate();
        } else {
            court.deactivate();
        }
        events.publishEvent(new FacilityEvent.CourtAvailabilityChanged(court.getId(), active));
        return court;
    }

    public Optional<OpeningHours> openingHoursFor(DayOfWeek day) {
        return openingHours.findByDayOfWeek(day.getValue());
    }

    public List<OpeningHours> allOpeningHours() {
        return openingHours.findAllByOrderByDayOfWeekAsc();
    }

    public List<WeeklyOpeningHours> weeklyOpeningHours() {
        Map<DayOfWeek, OpeningHours> configured = allOpeningHours().stream()
                .collect(Collectors.toMap(OpeningHours::getDayOfWeek, hours -> hours));

        return Arrays.stream(DayOfWeek.values())
                .map(day -> Optional.ofNullable(configured.get(day))
                        .map(hours -> new WeeklyOpeningHours(day, hours.getOpensAt(), hours.getClosesAt()))
                        .orElseGet(() -> new WeeklyOpeningHours(day, null, null)))
                .toList();
    }

    @Transactional
    public OpeningHours setOpeningHours(DayOfWeek day, OpeningWindow window) {
        OpeningWindow required = OpeningWindow.required(window);
        bookingGridCoordination.lock();
        BookingSlotDuration slotDuration = bookingGridSettings.slotDuration();
        if (!slotDuration.isAligned(required.opensAt())
                || !slotDuration.isAligned(required.closesAt())) {
            throw new OpeningHoursGridMismatchException(slotDuration.minutes());
        }
        return store(day, required);
    }

    @Transactional
    public void closeOn(DayOfWeek day) {
        close(day);
    }

    @Transactional
    public List<WeeklyOpeningHours> setWeeklyOpeningHours(List<WeeklyOpeningHours> week) {
        Map<DayOfWeek, WeeklyOpeningHours> requested = everyWeekdayOnce(week);
        bookingGridCoordination.lock();
        Map<DayOfWeek, OpeningWindow> windows =
                storable(requested, bookingGridSettings.slotDuration());
        windows.forEach((day, window) -> {
            if (window == null) {
                close(day);
            } else {
                store(day, window);
            }
        });
        return weeklyOpeningHours();
    }

    private static Map<DayOfWeek, WeeklyOpeningHours> everyWeekdayOnce(List<WeeklyOpeningHours> week) {
        if (week == null || week.size() != DayOfWeek.values().length) {
            throw new OpeningWeekIncompleteException();
        }
        Map<DayOfWeek, WeeklyOpeningHours> byDay = new EnumMap<>(DayOfWeek.class);
        week.forEach(day -> {
            if (day == null || day.dayOfWeek() == null
                    || byDay.put(day.dayOfWeek(), day) != null) {
                throw new OpeningWeekIncompleteException();
            }
        });
        return byDay;
    }

    // A null value is a day that closes; an EnumMap keeps both that and the order of the week.
    private static Map<DayOfWeek, OpeningWindow> storable(
            Map<DayOfWeek, WeeklyOpeningHours> requested, BookingSlotDuration slotDuration) {
        Map<DayOfWeek, OpeningWindow> windows = new EnumMap<>(DayOfWeek.class);
        List<OpeningHoursViolation> violations = new ArrayList<>();
        for (DayOfWeek day : DayOfWeek.values()) {
            WeeklyOpeningHours hours = requested.get(day);
            try {
                OpeningWindow window = OpeningWindow
                        .ofNullable(hours.opensAt(), hours.closesAt())
                        .orElse(null);
                if (window != null && (!slotDuration.isAligned(window.opensAt())
                        || !slotDuration.isAligned(window.closesAt()))) {
                    violations.add(OpeningHoursViolation.on(day,
                            "facility.openingHours.slotGridMismatch",
                            Map.of("slotMinutes", slotDuration.minutes())));
                    continue;
                }
                windows.put(day, window);
            } catch (InvalidOpeningWindowException rejected) {
                violations.add(OpeningHoursViolation.on(day, rejected.getCode(), Map.of()));
            }
        }
        if (!violations.isEmpty()) {
            throw new WeeklyOpeningHoursRejectedException(violations);
        }
        return windows;
    }

    private OpeningHours store(DayOfWeek day, OpeningWindow window) {
        Optional<OpeningHours> existing = openingHours.findByDayOfWeek(day.getValue());
        boolean changed = existing
                .map(hours -> !hours.getOpensAt().equals(window.opensAt())
                        || !hours.getClosesAt().equals(window.closesAt()))
                .orElse(true);
        OpeningHours saved = existing
                .map(hours -> {
                    hours.changeTo(window);
                    return hours;
                })
                .orElseGet(() -> openingHours.save(new OpeningHours(day, window)));
        if (changed) {
            events.publishEvent(new FacilityEvent.OpeningHoursSet(
                    saved.getId(), day.getValue(), window.opensAt(), window.closesAt()));
        }
        return saved;
    }

    private void close(DayOfWeek day) {
        openingHours.findByDayOfWeek(day.getValue()).ifPresent(hours -> {
            events.publishEvent(new FacilityEvent.OpeningHoursClosed(hours.getId(), day.getValue()));
            openingHours.deleteByDayOfWeek(day.getValue());
        });
    }

    public List<UUID> findUnbookableCourts(Collection<UUID> courtIds) {
        return courtIds.stream()
                .distinct()
                .filter(courtId -> findCourt(courtId).filter(Court::isActive).isEmpty())
                .toList();
    }

    public void requireBookableCourts(List<UUID> courtIds) {
        // Unreachable through the API, where minItems and uniqueItems answer for both.
        if (courtIds.isEmpty()) {
            throw new IllegalStateException("A booking needs at least one court");
        }
        if (Set.copyOf(courtIds).size() != courtIds.size()) {
            throw new IllegalStateException("A booking cannot hold the same court twice");
        }
        findUnbookableCourts(courtIds).stream().findFirst().ifPresent(courtId -> {
            throw new CourtNotBookableException(
                    findCourt(courtId).isPresent() ? "court.inactive" : "court.unknown",
                    Map.of("field", "courtIds"));
        });
    }

    public Court requireCourt(UUID courtId) {
        return courts.findById(courtId)
                .orElseThrow(() -> new CourtNotFoundException("No court with id " + courtId));
    }

    private Court saveOrRejectTakenNumber(Court court) {
        try {
            return courts.saveAndFlush(court);
        } catch (DataIntegrityViolationException e) {
            if (isNumberTaken(e)) {
                throw new CourtNumberTakenException(
                        "Court number %d is already taken".formatted(court.getNumber()), e);
            }
            throw e;
        }
    }

    private boolean isNumberTaken(DataIntegrityViolationException e) {
        return SqlConstraintViolation.matches(
                e, SqlConstraintViolation.UNIQUE_VIOLATION, UNIQUE_NUMBER_CONSTRAINT);
    }
}
