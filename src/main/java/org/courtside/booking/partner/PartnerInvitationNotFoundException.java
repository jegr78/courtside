package org.courtside.booking.partner;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class PartnerInvitationNotFoundException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "partner-invitation-not-found", HttpStatus.NOT_FOUND,
            "Open place not found", "No open place with this id is offered to you");

    PartnerInvitationNotFoundException() {
        super("partner.invitation.notFound", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
