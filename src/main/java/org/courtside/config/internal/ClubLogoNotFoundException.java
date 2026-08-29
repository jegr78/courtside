package org.courtside.config.internal;

import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

public class ClubLogoNotFoundException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "club-logo-not-found", HttpStatus.NOT_FOUND,
            "Club logo not found", "This instance has no uploaded club logo");

    public ClubLogoNotFoundException() {
        super("The club configuration has no uploaded logo");
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
