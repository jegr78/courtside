package org.courtside.facility;

import org.courtside.facility.internal.CourtNumberTakenException;
import org.courtside.facility.internal.CourtRepository;
import org.courtside.facility.internal.OpeningHoursRepository;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.OpeningWindow;
import org.courtside.config.BookingGridSettings;
import org.courtside.config.BookingSlotDuration;
import org.courtside.config.BookingGridCoordination;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
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
        return saveOrRejectTakenNumber(new Court(number, name));
    }

    @Transactional
    public Court changeCourt(UUID courtId, int number, String name) {
        Court court = requireCourt(courtId);
        court.changeTo(number, name);
        return saveOrRejectTakenNumber(court);
    }

    @Transactional
    public Court setCourtActive(UUID courtId, boolean active) {
        Court court = requireCourt(courtId);
        if (active) {
            court.activate();
        } else {
            court.deactivate();
        }
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
        return openingHours.findByDayOfWeek(day.getValue())
                .map(hours -> {
                    hours.changeTo(required);
                    return hours;
                })
                .orElseGet(() -> openingHours.save(new OpeningHours(day, required)));
    }

    @Transactional
    public void closeOn(DayOfWeek day) {
        openingHours.deleteByDayOfWeek(day.getValue());
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
        String message = e.getMostSpecificCause().getMessage();
        return message != null && message.contains(UNIQUE_NUMBER_CONSTRAINT);
    }
}
