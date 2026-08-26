package org.courtside.notification;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class MessageNotDeclinableException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "message-not-declinable", HttpStatus.CONFLICT,
            "Message cannot be switched off",
            "Some messages are what the club has to be able to send, and this is one of them");

    public MessageNotDeclinableException(MessageKind kind) {
        super("notification.message.notDeclinable", Map.of("kind", kind.name()));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
