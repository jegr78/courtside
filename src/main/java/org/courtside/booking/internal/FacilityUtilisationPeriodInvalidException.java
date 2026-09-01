package org.courtside.booking.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class FacilityUtilisationPeriodInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "facility-utilisation-period-invalid", HttpStatus.BAD_REQUEST,
            "Facility utilisation period invalid",
            "The facility utilisation period cannot be reported as asked");

    FacilityUtilisationPeriodInvalidException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
