package org.courtside.booking.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class ParticipantsInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "participants-invalid", HttpStatus.BAD_REQUEST,
            "Invalid participants", "The participants of this booking are not acceptable");

    public ParticipantsInvalidException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
