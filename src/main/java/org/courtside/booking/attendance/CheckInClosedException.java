package org.courtside.booking.attendance;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class CheckInClosedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "check-in-closed", HttpStatus.CONFLICT,
            "Check-in closed", "This booking cannot be checked in now");

    CheckInClosedException() {
        super("attendance.checkIn.closed", Map.of("opensMinutesBefore", AttendanceService.CHECK_IN_OPENS.toMinutes()));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
