package org.courtside.reporting.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class StatisticsPeriodInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "statistics-period-invalid", HttpStatus.BAD_REQUEST,
            "Statistics period invalid",
            "The statistics cannot be read for the period as asked");

    StatisticsPeriodInvalidException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
