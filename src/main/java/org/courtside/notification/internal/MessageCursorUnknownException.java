package org.courtside.notification.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class MessageCursorUnknownException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "message-cursor-unknown", HttpStatus.BAD_REQUEST,
            "Unknown cursor",
            "A restarted page is the one wrong answer a client cannot detect");

    MessageCursorUnknownException(String code, Map<String, Object> params) {
        super(code, params);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
