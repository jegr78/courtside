package org.courtside.notification.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

public class MessageTemplateRefusedException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "message-template-refused", HttpStatus.UNPROCESSABLE_ENTITY,
            "Message template refused", "The wording names a placeholder the message cannot fill or leaves out one it needs");

    private final List<MessageTemplateCatalog.Violation> violations;

    MessageTemplateRefusedException(List<MessageTemplateCatalog.Violation> violations) {
        super("message template refused");
        this.violations = List.copyOf(violations);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    protected Map<String, Object> properties() {
        return Map.of("violations", violations.stream()
                .map(found -> violation(found.code(),
                        found.placeholder() == null ? Map.of() : Map.of("placeholder", found.placeholder())))
                .toList());
    }
}
