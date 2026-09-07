package org.courtside.identity.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

class GuessablePasswordException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "password-too-guessable", HttpStatus.BAD_REQUEST,
            "Password is too guessable",
            "The password appears on a public list or is built from names this instance shows");

    // One answer for every list, so the refusal never tells a caller which one it landed on.
    GuessablePasswordException() {
        super("identity.password.tooGuessable", Map.of());
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
