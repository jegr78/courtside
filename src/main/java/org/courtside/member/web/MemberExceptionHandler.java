package org.courtside.member.web;

import org.courtside.member.internal.MembershipTypeNameTakenException;
import org.courtside.member.internal.MembershipTypeNotFoundException;
import org.courtside.member.MembershipTypeRuleSetInactiveException;
import org.courtside.member.MembershipTypeRuleSetInvalidException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

// MembershipTypeNameTakenException wraps the DataIntegrityViolationException a membership_type constraint raised.
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class MemberExceptionHandler {

    @ExceptionHandler(MembershipTypeNotFoundException.class)
    ProblemDetail handleUnknownMembershipType(MembershipTypeNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.NOT_FOUND, "No such membership type");
        problem.setType(URI.create("urn:courtside:error:membership-type-not-found"));
        problem.setTitle("Membership type not found");
        return problem;
    }

    @ExceptionHandler(MembershipTypeNameTakenException.class)
    ProblemDetail handleNameTaken(MembershipTypeNameTakenException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT, "This membership type name is already in use");
        problem.setType(URI.create("urn:courtside:error:membership-type-name-taken"));
        problem.setTitle("Name already in use");
        return problem;
    }

    @ExceptionHandler(MembershipTypeRuleSetInvalidException.class)
    ProblemDetail handleInvalidRuleSet(MembershipTypeRuleSetInvalidException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "The request references a rule set that does not exist");
        problem.setType(URI.create("urn:courtside:error:rule-set-unresolvable"));
        problem.setTitle("Rule set unresolvable");
        problem.setProperty("code", exception.getCode());
        problem.setProperty("params", exception.getParams());
        return problem;
    }

    @ExceptionHandler(MembershipTypeRuleSetInactiveException.class)
    ProblemDetail handleInactiveRuleSet(MembershipTypeRuleSetInactiveException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "The request references a rule set that is not active");
        problem.setType(URI.create("urn:courtside:error:rule-set-inactive"));
        problem.setTitle("Rule set inactive");
        problem.setProperty("code", exception.getCode());
        problem.setProperty("params", exception.getParams());
        return problem;
    }
}
