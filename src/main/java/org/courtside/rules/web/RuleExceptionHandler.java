package org.courtside.rules.web;

import org.courtside.rules.internal.RuleParameterInvalidException;
import org.courtside.rules.internal.RuleSetNameTakenException;
import org.courtside.rules.internal.RuleSetNotFoundException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

// RuleSetNameTakenException wraps the DataIntegrityViolationException the unique name constraint raised.
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class RuleExceptionHandler {

    @ExceptionHandler(RuleSetNotFoundException.class)
    ProblemDetail handleUnknownRuleSet(RuleSetNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.NOT_FOUND, "No such rule set");
        problem.setType(URI.create("urn:courtside:error:rule-set-not-found"));
        problem.setTitle("Rule set not found");
        return problem;
    }

    @ExceptionHandler(RuleSetNameTakenException.class)
    ProblemDetail handleNameTaken(RuleSetNameTakenException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT, "This rule set name is already in use");
        problem.setType(URI.create("urn:courtside:error:rule-set-name-taken"));
        problem.setTitle("Name already in use");
        return problem;
    }

    @ExceptionHandler(RuleParameterInvalidException.class)
    ProblemDetail handleRuleParameterInvalid(RuleParameterInvalidException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "The submitted rule parameters are not acceptable");
        problem.setType(URI.create("urn:courtside:error:rule-parameter-invalid"));
        problem.setTitle("Invalid rule parameters");
        problem.setProperty("code", exception.getCode());
        problem.setProperty("params", exception.getParams());
        return problem;
    }
}
