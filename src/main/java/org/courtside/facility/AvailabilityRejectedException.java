package org.courtside.facility;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.time.LocalDate;
import java.util.Map;

public class AvailabilityRejectedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "availability-rejected", HttpStatus.BAD_REQUEST,
            "Season, holiday or court closure rejected",
            "The dates or the name of a season, holiday or court closure cannot be stored");

    private AvailabilityRejectedException(String code, Map<String, Object> params) {
        super(code, params);
    }

    static AvailabilityRejectedException nameRequired() {
        return new AvailabilityRejectedException("facility.availability.nameRequired", Map.of());
    }

    static AvailabilityRejectedException nameTooLong(int maximum) {
        return new AvailabilityRejectedException("facility.availability.nameTooLong", Map.of("maximum", maximum));
    }

    static AvailabilityRejectedException endsBeforeStart() {
        return new AvailabilityRejectedException("facility.availability.endsBeforeStart", Map.of());
    }

    static AvailabilityRejectedException ended(LocalDate today) {
        return new AvailabilityRejectedException("facility.availability.ended", Map.of("today", today.toString()));
    }

    static AvailabilityRejectedException startsInPast(LocalDate today) {
        return new AvailabilityRejectedException("facility.availability.startsInPast", Map.of("today", today.toString()));
    }

    static AvailabilityRejectedException started(LocalDate startsOn) {
        return new AvailabilityRejectedException("facility.availability.started",
                Map.of("startsOn", startsOn.toString()));
    }

    static AvailabilityRejectedException tooLate(LocalDate latest) {
        return new AvailabilityRejectedException("facility.availability.tooLate", Map.of("latest", latest.toString()));
    }

    static AvailabilityRejectedException holidayHoursDiffer() {
        return new AvailabilityRejectedException("facility.availability.holidayHoursDiffer", Map.of());
    }

    static AvailabilityRejectedException overlap() {
        return new AvailabilityRejectedException("facility.availability.overlap", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
