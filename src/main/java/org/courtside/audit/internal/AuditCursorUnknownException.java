package org.courtside.audit.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AuditCursorUnknownException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "audit-cursor-unknown", HttpStatus.BAD_REQUEST,
            "Audit cursor unknown", "The cursor does not name an entry of the log");

    public AuditCursorUnknownException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
