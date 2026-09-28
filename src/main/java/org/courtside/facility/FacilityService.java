package org.courtside.facility;

import org.courtside.facility.internal.CourtNumberTakenException;
import org.courtside.facility.internal.CourtRepository;
import org.courtside.facility.internal.OpeningHoursRepository;
import org.courtside.facility.internal.OpeningHoursVersion;
import org.courtside.facility.internal.OpeningHoursVersionRepository;
import org.courtside.facility.internal.OpeningSchedules;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.InvalidOpeningWindowException;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.SqlConstraintViolation;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.BookingGridCoordination;
import org.courtside.config.ClubTimeZone;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
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

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FacilityService {

    private static final String UNIQUE_NUMBER_CONSTRAINT = "court_unique_number";
    private static final LocalDate LATEST_START = LocalDate.of(9999, 12, 31);

    private final CourtRepository courts;
    private final OpeningHoursRepository openingHours;
    private final OpeningHoursVersionRepository versions;
    private final OpeningSchedules schedules;
    private final ClubTimeZone clubTimeZone;
    private final Clock clock;
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

    public OpeningSchedule openingSchedule() {
        return schedules.load();
    }

    public LocalDate today() {
        return LocalDate.ofInstant(clock.instant(), clubTimeZone.zoneId());
    }

    public List<WeeklyOpeningHours> weeklyOpeningHours() {
        return weekdaysOf(openingSchedule().weekOn(today()).orElse(null));
    }

    private static List<WeeklyOpeningHours> weekdaysOf(OpeningWeek week) {
        return Arrays.stream(DayOfWeek.values())
                .map(day -> Optional.ofNullable(week).flatMap(present -> present.windowOn(day))
                        .map(window -> new WeeklyOpeningHours(day, window.opensAt(), window.closesAt()))
                        .orElseGet(() -> new WeeklyOpeningHours(day, null, null)))
                .toList();
    }

    /** Changes one day of the week in force today, including the days that week already governed. */
    @Transactional
    public OpeningHours setOpeningHours(DayOfWeek day, OpeningWindow window) {
        OpeningWindow required = OpeningWindow.required(window);
        bookingGridCoordination.lock();
        BookingSlotDuration slotDuration = bookingGridSettings.slotDuration();
        if (!slotDuration.isAligned(required.opensAt())
                || !slotDuration.isAligned(required.closesAt())) {
            throw new OpeningHoursGridMismatchException(slotDuration.minutes());
        }
        OpeningHoursVersion version = versionInForceToday();
        return store(version, day, required, openingSchedule().nextChangeAfter(today()).orElse(null));
    }

    /** Closes one day of the week in force today, including the days that week already governed. */
    @Transactional
    public void closeOn(DayOfWeek day) {
        bookingGridCoordination.lock();
        close(versionInForceToday(), day, openingSchedule().nextChangeAfter(today()).orElse(null));
    }

    @Transactional
    public List<WeeklyOpeningHours> setWeeklyOpeningHours(List<WeeklyOpeningHours> week) {
        return weekdaysOf(scheduleOpeningHours(null, week));
    }

    /**
     * Stores a week that takes effect on {@code effectiveFrom}, today when it is null. A week that
     * already starts on that day is replaced; earlier weeks keep governing the days before it.
     */
    @Transactional
    public OpeningWeek scheduleOpeningHours(LocalDate effectiveFrom, List<WeeklyOpeningHours> week) {
        Map<DayOfWeek, WeeklyOpeningHours> requested = everyWeekdayOnce(week);
        bookingGridCoordination.lock();
        LocalDate today = today();
        LocalDate start = effectiveFrom == null ? today : effectiveFrom;
        if (start.isBefore(today)) {
            throw OpeningHoursStartRejectedException.inThePast(today);
        }
        if (start.isAfter(LATEST_START)) {
            throw OpeningHoursStartRejectedException.afterTheLatestDay(LATEST_START);
        }
        Map<DayOfWeek, OpeningWindow> windows =
                storable(requested, bookingGridSettings.slotDuration());
        OpeningSchedule schedule = openingSchedule();
        Optional<OpeningWeek> previous = schedule.weekOn(start);
        LocalDate until = schedule.nextChangeAfter(start).orElse(null);
        OpeningHoursVersion version = versions.findByEffectiveFrom(start)
                .orElseGet(() -> versions.save(new OpeningHoursVersion(start)));
        for (DayOfWeek day : DayOfWeek.values()) {
            OpeningWindow window = windows.get(day);
            Optional<OpeningWindow> before = previous.flatMap(inForce -> inForce.windowOn(day));
            if (window == null) {
                openingHours.deleteByVersionIdAndDayOfWeek(version.getId(), day.getValue());
                if (before.isPresent()) {
                    events.publishEvent(new FacilityEvent.OpeningHoursClosed(
                            null, day.getValue(), version.getId(), start, until));
                }
            } else {
                OpeningHours saved = upsert(version, day, window);
                if (before.filter(window::equals).isEmpty()) {
                    publishSet(saved, window, start, until);
                }
            }
        }
        return openingSchedule().weekOn(start).orElseThrow();
    }

    /**
     * Removes a week that has not taken effect yet. The week before it governs its days again, and
     * the events name every day on which that changes the hours.
     */
    @Transactional
    public void removeScheduledOpeningHours(LocalDate effectiveFrom) {
        if (effectiveFrom == null) {
            throw new IllegalStateException("A scheduled week is removed by the day it starts");
        }
        bookingGridCoordination.lock();
        if (!effectiveFrom.isAfter(today())) {
            throw new OpeningHoursVersionInForceException(effectiveFrom);
        }
        OpeningHoursVersion version = versions.findByEffectiveFrom(effectiveFrom)
                .orElseThrow(() -> new OpeningHoursVersionNotFoundException(effectiveFrom));
        OpeningSchedule schedule = openingSchedule();
        OpeningWeek removed = schedule.weekOn(effectiveFrom).orElseThrow();
        Optional<OpeningWeek> restored = schedule.weekOn(effectiveFrom.minusDays(1));
        LocalDate until = schedule.nextChangeAfter(effectiveFrom).orElse(null);
        versions.delete(version);
        versions.flush();
        for (DayOfWeek day : DayOfWeek.values()) {
            Optional<OpeningWindow> after = restored.flatMap(week -> week.windowOn(day));
            if (after.equals(removed.windowOn(day))) {
                continue;
            }
            if (after.isEmpty()) {
                events.publishEvent(new FacilityEvent.OpeningHoursClosed(null, day.getValue(),
                        restored.map(OpeningWeek::id).orElse(version.getId()), effectiveFrom, until));
            } else {
                OpeningHours row = openingHours.findByVersionIdAndDayOfWeek(
                        restored.orElseThrow().id(), day.getValue()).orElseThrow();
                publishSet(row, after.get(), effectiveFrom, until);
            }
        }
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

    private OpeningHoursVersion versionInForceToday() {
        return openingSchedule().weekOn(today())
                .flatMap(week -> versions.findById(week.id()))
                .orElseGet(() -> versions.findByEffectiveFromIsNull()
                        .orElseGet(() -> versions.save(new OpeningHoursVersion(null))));
    }

    private OpeningHours store(OpeningHoursVersion version, DayOfWeek day, OpeningWindow window,
                               LocalDate until) {
        boolean changed = openingHours.findByVersionIdAndDayOfWeek(version.getId(), day.getValue())
                .map(hours -> !hours.getOpensAt().equals(window.opensAt())
                        || !hours.getClosesAt().equals(window.closesAt()))
                .orElse(true);
        OpeningHours saved = upsert(version, day, window);
        if (changed) {
            publishSet(saved, window, version.getEffectiveFrom(), until);
        }
        return saved;
    }

    private OpeningHours upsert(OpeningHoursVersion version, DayOfWeek day, OpeningWindow window) {
        return openingHours.findByVersionIdAndDayOfWeek(version.getId(), day.getValue())
                .map(hours -> {
                    hours.changeTo(window);
                    return hours;
                })
                .orElseGet(() -> openingHours.save(new OpeningHours(version.getId(), day, window)));
    }

    private void close(OpeningHoursVersion version, DayOfWeek day, LocalDate until) {
        openingHours.findByVersionIdAndDayOfWeek(version.getId(), day.getValue()).ifPresent(hours -> {
            events.publishEvent(new FacilityEvent.OpeningHoursClosed(hours.getId(), day.getValue(),
                    version.getId(), version.getEffectiveFrom(), until));
            openingHours.deleteByVersionIdAndDayOfWeek(version.getId(), day.getValue());
        });
    }

    private void publishSet(OpeningHours row, OpeningWindow window, LocalDate effectiveFrom,
                            LocalDate until) {
        events.publishEvent(new FacilityEvent.OpeningHoursSet(row.getId(), row.getDayOfWeek().getValue(),
                window.opensAt(), window.closesAt(), row.getVersionId(), effectiveFrom, until));
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
