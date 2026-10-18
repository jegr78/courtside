package org.courtside.member.internal;

import org.courtside.member.GuardianGrant;
import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class GuardianActionNotGrantedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "guardian-action-not-granted", HttpStatus.FORBIDDEN,
            "Action not granted", "Your relationship with this dependant does not grant this action");

    public GuardianActionNotGrantedException(GuardianGrant grant) {
        this("guardianship.actionNotGranted", grant);
    }

    public GuardianActionNotGrantedException(String code, GuardianGrant grant) {
        super(code, Map.of("action", grant.name()));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
