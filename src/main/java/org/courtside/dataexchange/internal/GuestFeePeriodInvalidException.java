package org.courtside.dataexchange.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class GuestFeePeriodInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "guest-fee-period-invalid", HttpStatus.BAD_REQUEST,
            "Guest fee period invalid", "The guest fee period cannot be reported as asked");

    GuestFeePeriodInvalidException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
