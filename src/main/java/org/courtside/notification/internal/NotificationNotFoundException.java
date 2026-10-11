package org.courtside.notification.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class NotificationNotFoundException extends CodedDomainFailure {

    static final ProblemType PROBLEM_TYPE = new ProblemType(
            "notification-not-found", HttpStatus.NOT_FOUND,
            "Notification not found",
            "No notification with this id is addressed to you");

    NotificationNotFoundException() {
        super("notification.notFound", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
