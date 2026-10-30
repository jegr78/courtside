package org.courtside.access.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AccessControlNotConnectedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "access-control-not-connected", HttpStatus.CONFLICT, "Access control not connected", "No access-control system is connected");

    AccessControlNotConnectedException() {
        super("access.control.notConnected", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
