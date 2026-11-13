package org.courtside.identity;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class UsernameReservedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "username-reserved", HttpStatus.BAD_REQUEST,
            "Username reserved", "Usernames starting with anonymised- are reserved for closed accounts");

    public UsernameReservedException() {
        super("identity.username.reserved", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
