package org.courtside.config.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class TimeZoneConflictException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "time-zone-conflict", HttpStatus.CONFLICT,
            "Time zone conflicts with bookings",
            "Future bookings prevent changing the club time zone");

    TimeZoneConflictException(String code, String timeZone) {
        super(code, Map.of("timeZone", timeZone));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
