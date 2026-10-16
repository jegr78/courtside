package org.courtside.booking.attendance;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AttendanceNotRecordableException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "attendance-not-recordable", HttpStatus.CONFLICT,
            "Attendance not recordable", "Attendance is recorded for a member's booking once it has started");

    AttendanceNotRecordableException() {
        super("attendance.notRecordable", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
