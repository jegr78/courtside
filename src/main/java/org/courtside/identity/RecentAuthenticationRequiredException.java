package org.courtside.identity;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class RecentAuthenticationRequiredException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "recent-authentication-required", HttpStatus.FORBIDDEN,
            "Recent authentication required",
            "Prove the current authentication factors again before this operation");

    public RecentAuthenticationRequiredException() {
        super("identity.reauthentication.required", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
