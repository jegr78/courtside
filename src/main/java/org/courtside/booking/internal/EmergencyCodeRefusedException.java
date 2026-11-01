package org.courtside.booking.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class EmergencyCodeRefusedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "emergency-code-refused", HttpStatus.CONFLICT,
            "Emergency code refused", "The emergency code of this booking cannot be given now");

    private EmergencyCodeRefusedException(String code) {
        super(code, Map.of());
    }

    static EmergencyCodeRefusedException notParticipant() {
        return new EmergencyCodeRefusedException("booking.emergencyCode.notParticipant");
    }

    static EmergencyCodeRefusedException outsideWindow() {
        return new EmergencyCodeRefusedException("booking.emergencyCode.outsideWindow");
    }

    static EmergencyCodeRefusedException cancelled() {
        return new EmergencyCodeRefusedException("booking.emergencyCode.cancelled");
    }

    static EmergencyCodeRefusedException noneKept() {
        return new EmergencyCodeRefusedException("booking.emergencyCode.noneKept");
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
