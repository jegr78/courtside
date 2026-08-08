package org.courtside.shared.web;

import jakarta.validation.ConstraintViolation;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

// Ordered ahead of Boot's own spring.mvc.problemdetails fallback advice, which otherwise wins the
// tie for MethodArgumentNotValidException and answers with its generic, field-less detail — but
// behind module-specific advices such as BookingExceptionHandler, which must resolve their own
// exceptions before this one can claim them by walking their cause chain (Spring's resolver
// recurses to the end of it, not just one level). AdviceOrderingTest enforces this for every
// advice, present and future.
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE + 1000)
class SharedExceptionHandler {

    // Every bundle entry interpolates at most these; anything else a constraint carries (a
    // @Pattern's regexp, for one) must not reach a client, so this is an allowlist, not a denylist.
    private static final Map<String, Set<String>> ALLOWED_PARAMS_BY_CONSTRAINT = Map.of(
            "Size", Set.of("min", "max"),
            "Min", Set.of("value"),
            "Max", Set.of("value"));

    // Deliberately narrow: a write that raises a more specific conflict exception instead of
    // letting the underlying constraint violation through must not have it downgraded to a 400
    // here, which would turn a 409 into one. A module that knows what a particular constraint
    // means translates it to a typed exception with its own advice, ordered ahead of this one, so
    // this only ever answers for a violation nothing upstream recognised — it must not guess at a
    // cause (a foreign key, a check, a not-null constraint) it cannot actually name.
    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail handleRejectedByTheDatabase(DataIntegrityViolationException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "The request conflicts with a database constraint");
        problem.setType(URI.create("urn:courtside:error:constraint-violation"));
        problem.setTitle("Constraint violation");
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail handleValidationFailure(MethodArgumentNotValidException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "The request does not pass validation");
        problem.setType(URI.create("urn:courtside:error:validation-failed"));
        problem.setTitle("Validation failed");
        problem.setProperty("fieldErrors", exception.getBindingResult().getFieldErrors().stream()
                .map(SharedExceptionHandler::toMap)
                .toList());
        return problem;
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ProblemDetail handleParameterTypeMismatch(MethodArgumentTypeMismatchException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "One of the request's parameters is not valid");
        problem.setType(URI.create("urn:courtside:error:parameter-type-mismatch"));
        problem.setTitle("Parameter type mismatch");
        problem.setProperty("code", "request.parameterTypeMismatch");
        problem.setProperty("params", Map.of("parameter", exception.getName()));
        return problem;
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ProblemDetail handleUnreadableBody(HttpMessageNotReadableException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "The request body could not be parsed");
        problem.setType(URI.create("urn:courtside:error:malformed-request-body"));
        problem.setTitle("Malformed request body");
        return problem;
    }

    // RFC 9110 §15.5.6 makes Allow mandatory on a 405, and it is the only machine-readable
    // statement of what is allowed — HttpRequestMethodNotSupportedException.getHeaders() already
    // carries it, so a bare ProblemDetail must not be returned in its place.
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ProblemDetail> handleUnsupportedMethod(HttpRequestMethodNotSupportedException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.METHOD_NOT_ALLOWED, "This HTTP method is not supported for this resource");
        problem.setType(URI.create("urn:courtside:error:method-not-supported"));
        problem.setTitle("Method not allowed");
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .headers(exception.getHeaders())
                .body(problem);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ProblemDetail handleUnknownResource(NoResourceFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.NOT_FOUND, "No resource exists at this address");
        problem.setType(URI.create("urn:courtside:error:unmapped-path"));
        problem.setTitle("Unmapped path");
        return problem;
    }

    // HttpMediaTypeNotSupportedException.getHeaders() carries Accept, the same way
    // HttpRequestMethodNotSupportedException.getHeaders() carries Allow above — RFC 9110 does not
    // make it mandatory on a 415, but dropping it is the same loss of a machine-readable answer.
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ProblemDetail> handleUnsupportedMediaType(HttpMediaTypeNotSupportedException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.UNSUPPORTED_MEDIA_TYPE, "This endpoint does not accept the request's content type");
        problem.setType(URI.create("urn:courtside:error:unsupported-media-type"));
        problem.setTitle("Unsupported media type");
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .headers(exception.getHeaders())
                .body(problem);
    }

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    ProblemDetail handleNotAcceptable(HttpMediaTypeNotAcceptableException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.NOT_ACCEPTABLE, "This endpoint cannot produce a representation the request accepts");
        problem.setType(URI.create("urn:courtside:error:not-acceptable"));
        problem.setTitle("Not acceptable");
        return problem;
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    ProblemDetail handleMissingParameter(MissingServletRequestParameterException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "A required request parameter is missing");
        problem.setType(URI.create("urn:courtside:error:missing-parameter"));
        problem.setTitle("Missing parameter");
        problem.setProperty("code", "request.missingParameter");
        problem.setProperty("params", Map.of("parameter", exception.getParameterName()));
        return problem;
    }

    private static Map<String, Object> toMap(FieldError error) {
        if (!error.contains(ConstraintViolation.class)) {
            return Map.of("field", error.getField(), "code", "validation.rejected", "params", Map.of());
        }

        ConstraintViolation<?> violation = error.unwrap(ConstraintViolation.class);
        String constraintName = violation.getConstraintDescriptor().getAnnotation()
                .annotationType().getSimpleName();
        Map<String, Object> attributes = violation.getConstraintDescriptor().getAttributes();
        Set<String> allowedParams = ALLOWED_PARAMS_BY_CONSTRAINT.getOrDefault(constraintName, Set.of());

        Map<String, Object> params = new LinkedHashMap<>();
        allowedParams.forEach(name -> params.put(name, attributes.get(name)));

        return Map.of(
                "field", error.getField(),
                "code", "validation." + constraintName,
                "params", params);
    }
}
