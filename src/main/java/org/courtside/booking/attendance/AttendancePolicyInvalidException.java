package org.courtside.booking.attendance;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AttendancePolicyInvalidException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "attendance-policy-invalid", HttpStatus.BAD_REQUEST,
            "Attendance policy invalid", "The attendance policy cannot be saved like this");

    AttendancePolicyInvalidException(String code) {
        super(code, Map.of("minimum", AttendancePolicy.MIN_RELEASE_MINUTES,
                "maximum", AttendancePolicy.MAX_RELEASE_MINUTES));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
