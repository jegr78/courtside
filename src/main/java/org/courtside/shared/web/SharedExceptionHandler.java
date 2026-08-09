package org.courtside.shared.web;

import jakarta.validation.ConstraintViolation;
import org.courtside.shared.DuplicateItemException;
import tools.jackson.core.JacksonException;
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
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

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
        return validationFailed(exception.getBindingResult().getFieldErrors().stream()
                .map(SharedExceptionHandler::toMap)
                .toList());
    }

    // One builder for both advices that answer with this type: ProblemTypeUriTest reads the type
    // literals an advice sets and expects each slug once, so a second literal here would read as a
    // second, unreviewed problem type rather than as the same one reached two ways.
    private static ProblemDetail validationFailed(List<Map<String, Object>> fieldErrors) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "The request does not pass validation");
        problem.setType(URI.create("urn:courtside:error:validation-failed"));
        problem.setTitle("Validation failed");
        problem.setProperty("fieldErrors", fieldErrors);
        return problem;
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ProblemDetail handleParameterTypeMismatch(MethodArgumentTypeMismatchException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "One of the request's parameters is not valid");
        problem.setType(URI.create("urn:courtside:error:parameter-type-mismatch"));
        problem.setTitle("Parameter type mismatch");
        problem.setProperty("violations", List.of(Map.of(
                "code", "request.parameterTypeMismatch",
                "params", Map.of("parameter", exception.getName()))));
        return problem;
    }

    // Jackson records the property path as a mismatch unwinds, so a value it cannot read — an
    // unknown enum constant, a malformed uuid, a date that is not one, a duplicate in an array the
    // contract declares unique — can be reported as the field it came from rather than as "the
    // body was unreadable". Without this the caller is told only that something, somewhere, is
    // wrong with a request they wrote.
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ProblemDetail handleUnreadableBody(HttpMessageNotReadableException exception) {
        String field = mismatchedField(exception);
        if (field == null) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                    HttpStatus.BAD_REQUEST, "The request body could not be parsed");
            problem.setType(URI.create("urn:courtside:error:malformed-request-body"));
            problem.setTitle("Malformed request body");
            return problem;
        }

        // Written out twice rather than as one map with a computed code: ValidationMessageCoverageTest
        // finds a code by the literal that follows the "code" key, and a code it cannot see is a
        // code with no bundle entry.
        return validationFailed(List.of(
                exception.getCause() instanceof DuplicateItemException
                        ? Map.of("field", field, "code", "validation.NoDuplicates", "params", Map.of())
                        : Map.of("field", field, "code", "validation.TypeMismatch", "params", Map.of())));
    }

    private static String mismatchedField(HttpMessageNotReadableException exception) {
        if (!(exception.getCause() instanceof JacksonException mismatch)) {
            return null;
        }
        String path = mismatch.getPath().stream()
                .map(reference -> reference.getPropertyName())
                .filter(Objects::nonNull)
                .collect(Collectors.joining("."));
        return path.isEmpty() ? null : path;
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
        problem.setProperty("violations", List.of(Map.of(
                "code", "request.missingParameter",
                "params", Map.of("parameter", exception.getParameterName()))));
        return problem;
    }

    private static Map<String, Object> toMap(FieldError error) {
        if (!error.contains(ConstraintViolation.class)) {
            // A Spring Validator's rejection carries its own code — a cross-field rule the request
            // record cannot hold. Falling back to "rejected" would throw that name away and leave
            // a client unable to tell one such rule from another.
            String code = error.getCode();
            return Map.of("field", error.getField(),
                    "code", code == null ? "validation.rejected" : "validation." + code,
                    "params", Map.of());
        }

        ConstraintViolation<?> violation = error.unwrap(ConstraintViolation.class);
        String constraintName = violation.getConstraintDescriptor().getAnnotation()
                .annotationType().getSimpleName();
        Map<String, Object> attributes = violation.getConstraintDescriptor().getAttributes();
        Set<String> allowedParams = ALLOWED_PARAMS_BY_CONSTRAINT.getOrDefault(constraintName, Set.of());

        Map<String, Object> params = new LinkedHashMap<>();
        allowedParams.forEach(name -> params.put(name, attributes.get(name)));

        // minItems with no maximum generates @Size(min = 1), whose max is Integer.MAX_VALUE. A
        // message reading "between 1 and 2147483647 in length" tells a caller nothing, and two
        // billion is not information — so the unbounded case is its own code with its own message.
        if ("Size".equals(constraintName) && Integer.valueOf(Integer.MAX_VALUE).equals(params.get("max"))) {
            params.remove("max");
            return Map.of(
                    "field", error.getField(),
                    "code", "validation.SizeAtLeast",
                    "params", params);
        }

        return Map.of(
                "field", error.getField(),
                "code", "validation." + constraintName,
                "params", params);
    }
}
