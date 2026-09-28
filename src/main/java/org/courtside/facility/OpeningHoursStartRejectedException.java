package org.courtside.facility;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.time.LocalDate;
import java.util.Map;

public class OpeningHoursStartRejectedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "opening-hours-start-rejected", HttpStatus.BAD_REQUEST,
            "Opening hours cannot start on that day",
            "New opening hours take effect today or on a later day the calendar can hold");

    private OpeningHoursStartRejectedException(String code, Map<String, Object> params) {
        super(code, params);
    }

    static OpeningHoursStartRejectedException inThePast(LocalDate today) {
        return new OpeningHoursStartRejectedException(
                "facility.openingHours.effectiveInPast", Map.of("today", today.toString()));
    }

    static OpeningHoursStartRejectedException afterTheLatestDay(LocalDate latest) {
        return new OpeningHoursStartRejectedException(
                "facility.openingHours.effectiveTooLate", Map.of("latest", latest.toString()));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
