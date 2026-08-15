package org.courtside.member;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class RosterCursorUnknownException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "roster-cursor-unknown", HttpStatus.BAD_REQUEST,
            "Roster cursor unknown", "The cursor names a person the roster no longer holds");

    RosterCursorUnknownException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
