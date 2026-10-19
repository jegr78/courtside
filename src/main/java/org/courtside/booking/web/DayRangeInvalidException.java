package org.courtside.booking.web;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class DayRangeInvalidException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "day-range-invalid", HttpStatus.BAD_REQUEST,
            "Day range invalid", "The days asked for cannot be read in one request");

    DayRangeInvalidException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
