package org.courtside.booking.attendance;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AttendanceNotTrackedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "attendance-not-tracked", HttpStatus.CONFLICT,
            "Attendance not tracked", "This club does not record attendance");

    AttendanceNotTrackedException() {
        super("attendance.notTracked", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
