package org.courtside.shared.web;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.courtside.shared.DuplicateItemException;
import tools.jackson.core.JacksonException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
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
import java.util.Set;
import java.util.regex.Pattern;

// Ahead of Boot's problemdetails fallback, behind the module advices that must claim their own
// exceptions first. AdviceOrderingTest enforces it.
@Slf4j
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE + 1000)
class SharedExceptionHandler {

    // Every bundle entry interpolates at most these; anything else a constraint carries (a
    // @Pattern's regexp, for one) must not reach a client, so this is an allowlist, not a denylist.
    private static final Map<String, Set<String>> ALLOWED_PARAMS_BY_CONSTRAINT = Map.of(
            "Size", Set.of("min", "max"),
            "Min", Set.of("value"),
            "Max", Set.of("value"));

    // Only for a violation nothing upstream recognised, and it must not guess at which
    // constraint: naming one would downgrade a module's 409 to a 400.
    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail handleRejectedByTheDatabase(DataIntegrityViolationException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "The request conflicts with a database constraint");
        problem.setType(URI.create("urn:courtside:error:constraint-violation"));
        problem.setTitle("Constraint violation");
        logAnswered(problem);
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail handleValidationFailure(MethodArgumentNotValidException exception) {
        List<Map<String, Object>> fieldErrors = exception.getBindingResult().getFieldErrors().stream()
                .map(SharedExceptionHandler::toMap)
                .toList();
        ProblemDetail problem = validationFailed(fieldErrors);
        logAnswered(problem, fieldsOf(fieldErrors));
        return problem;
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ProblemDetail handleMethodValidationFailure(ConstraintViolationException exception) {
        List<Map<String, Object>> fieldErrors = exception.getConstraintViolations().stream()
                .map(violation -> toMap(lastPathNode(violation), violation))
                .toList();
        ProblemDetail problem = validationFailed(fieldErrors);
        logAnswered(problem, fieldsOf(fieldErrors));
        return problem;
    }

    // One builder, because ProblemTypeUriTest expects each slug's literal exactly once.
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
        logAnswered(problem, List.of(exception.getName()));
        return problem;
    }

    // Jackson records the property path as a mismatch unwinds, so a value it cannot read names
    // its field instead of leaving the caller with "something in the body is wrong".
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ProblemDetail handleUnreadableBody(HttpMessageNotReadableException exception) {
        String field = mismatchedField(exception);
        if (field == null) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                    HttpStatus.BAD_REQUEST, "The request body could not be parsed");
            problem.setType(URI.create("urn:courtside:error:malformed-request-body"));
            problem.setTitle("Malformed request body");
            logAnswered(problem);
            return problem;
        }

        // Twice, not one map with a computed code: ValidationMessageCoverageTest finds a code
        // by the literal following the "code" key, and one it cannot see has no bundle entry.
        ProblemDetail problem = validationFailed(List.of(
                exception.getCause() instanceof DuplicateItemException
                        ? Map.of("field", field, "code", "validation.NoDuplicates", "params", Map.of())
                        : Map.of("field", field, "code", "validation.TypeMismatch", "params", Map.of())));
        logAnswered(problem, List.of(field));
        return problem;
    }

    // The keys of an additionalProperties object are whatever the caller sent, so anything
    // outside this set is not echoed back.
    private static final Pattern A_NAME_THIS_API_DEFINES = Pattern.compile("[A-Za-z0-9_-]{1,40}");

    private static String mismatchedField(HttpMessageNotReadableException exception) {
        if (!(exception.getCause() instanceof JacksonException mismatch)) {
            return null;
        }
        StringBuilder field = new StringBuilder();
        for (JacksonException.Reference reference : mismatch.getPath()) {
            // Bean Validation names the same field "participants[0].personId"; without the
            // index a caller cannot tell which entry to correct.
            if (reference.getIndex() >= 0) {
                field.append('[').append(reference.getIndex()).append(']');
                continue;
            }
            String name = reference.getPropertyName();
            if (name == null) {
                continue;
            }
            if (reference.from() instanceof Map<?, ?> && !A_NAME_THIS_API_DEFINES.matcher(name).matches()) {
                break;
            }
            if (!field.isEmpty()) {
                field.append('.');
            }
            field.append(name);
        }
        return field.isEmpty() ? null : field.toString();
    }

    // RFC 9110 §15.5.6 makes Allow mandatory on a 405, and getHeaders() already carries it.
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ProblemDetail> handleUnsupportedMethod(HttpRequestMethodNotSupportedException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.METHOD_NOT_ALLOWED, "This HTTP method is not supported for this resource");
        problem.setType(URI.create("urn:courtside:error:method-not-supported"));
        problem.setTitle("Method not allowed");
        logAnswered(problem);
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
        logAnswered(problem);
        return problem;
    }

    // getHeaders() carries Accept, as it carries Allow above. Not mandatory on a 415, but
    // dropping it loses the same machine-readable answer.
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ProblemDetail> handleUnsupportedMediaType(HttpMediaTypeNotSupportedException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.UNSUPPORTED_MEDIA_TYPE, "This endpoint does not accept the request's content type");
        problem.setType(URI.create("urn:courtside:error:unsupported-media-type"));
        problem.setTitle("Unsupported media type");
        logAnswered(problem);
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
        logAnswered(problem);
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
        logAnswered(problem, List.of(exception.getParameterName()));
        return problem;
    }

    private static Map<String, Object> toMap(FieldError error) {
        if (!error.contains(ConstraintViolation.class)) {
            // A Validator's rejection carries its own code; falling back to "rejected" would
            // leave a client unable to tell one cross-field rule from another.
            String code = error.getCode();
            return Map.of("field", error.getField(),
                    "code", code == null ? "validation.rejected" : "validation." + code,
                    "params", Map.of());
        }

        ConstraintViolation<?> violation = error.unwrap(ConstraintViolation.class);
        return toMap(error.getField(), violation);
    }

    private static String lastPathNode(ConstraintViolation<?> violation) {
        String field = null;
        for (jakarta.validation.Path.Node node : violation.getPropertyPath()) {
            field = node.getName();
        }
        return field == null ? "request" : field;
    }

    private static Map<String, Object> toMap(String field, ConstraintViolation<?> violation) {
        String constraintName = violation.getConstraintDescriptor().getAnnotation()
                .annotationType().getSimpleName();
        Map<String, Object> attributes = violation.getConstraintDescriptor().getAttributes();
        Set<String> allowedParams = ALLOWED_PARAMS_BY_CONSTRAINT.getOrDefault(constraintName, Set.of());

        Map<String, Object> params = new LinkedHashMap<>();
        allowedParams.forEach(name -> params.put(name, attributes.get(name)));

        // An unbounded minItems generates @Size(min = 1) with max = Integer.MAX_VALUE, and no
        // message can name two billion usefully.
        if ("Size".equals(constraintName) && Integer.valueOf(Integer.MAX_VALUE).equals(params.get("max"))) {
            params.remove("max");
            return Map.of(
                    "field", field,
                    "code", "validation.SizeAtLeast",
                    "params", params);
        }

        return Map.of(
                "field", field,
                "code", "validation." + constraintName,
                "params", params);
    }

    // The problem type, so a log line and the response a member reads share one token. Never the
    // exception: its message embeds the rejected value, a cleartext password on some endpoints.
    private static void logAnswered(ProblemDetail problem) {
        log.debug("Answering {} for {}", HttpStatusCode.valueOf(problem.getStatus()), problem.getType());
    }

    private static void logAnswered(ProblemDetail problem, List<String> fields) {
        log.debug("Answering {} for {}: {}",
                HttpStatusCode.valueOf(problem.getStatus()), problem.getType(), fields);
    }

    private static List<String> fieldsOf(List<Map<String, Object>> fieldErrors) {
        return fieldErrors.stream().map(error -> (String) error.get("field")).toList();
    }
}
