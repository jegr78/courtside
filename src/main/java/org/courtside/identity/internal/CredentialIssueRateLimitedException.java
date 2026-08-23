package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class CredentialIssueRateLimitedException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "credential-issue-rate-limited", HttpStatus.TOO_MANY_REQUESTS,
            "Too many credentials issued",
            "This account has been sent credentials too often; try again later");

    CredentialIssueRateLimitedException(int maxPerWindow) {
        super("identity.credentials.rateLimited", Map.of("maxPerWindow", maxPerWindow));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
