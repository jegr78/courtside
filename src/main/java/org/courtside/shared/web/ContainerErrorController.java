package org.courtside.shared.web;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;

// What the container answers on its own - a refused method, a filter that threw - reaches no advice.
@Slf4j
@RestController
@RequiredArgsConstructor
class ContainerErrorController implements ErrorController {

    private final ProblemTraceReference traceReference;

    @RequestMapping("${server.error.path:/error}")
    ResponseEntity<ProblemDetail> handleContainerError(HttpServletRequest request) {
        HttpStatus status = statusOf(request);
        ProblemDetail problem = problemFor(status);
        if (request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI) instanceof String requestUri) {
            problem.setInstance(URI.create(requestUri));
        }
        traceReference.addTo(problem);
        log.debug("Answering {} for {}", status, problem.getType());
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    private static ProblemDetail problemFor(HttpStatus status) {
        if (status == HttpStatus.METHOD_NOT_ALLOWED) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                    status, "This HTTP method is not supported for this resource");
            problem.setType(URI.create("urn:courtside:error:method-not-supported"));
            problem.setTitle("Method not allowed");
            return problem;
        }
        if (status == HttpStatus.NOT_FOUND) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                    status, "No resource exists at this address");
            problem.setType(URI.create("urn:courtside:error:unmapped-path"));
            problem.setTitle("Unmapped path");
            return problem;
        }
        if (status.is5xxServerError()) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                    status, "This request could not be completed");
            problem.setType(URI.create("urn:courtside:error:internal-error"));
            problem.setTitle("Internal error");
            return problem;
        }
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                status, "This request was rejected before it reached the application");
        problem.setType(URI.create("urn:courtside:error:request-rejected"));
        problem.setTitle("Request rejected");
        return problem;
    }

    private static HttpStatus statusOf(HttpServletRequest request) {
        HttpStatus status = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) instanceof Integer code
                ? HttpStatus.resolve(code)
                : null;
        return status == null ? HttpStatus.INTERNAL_SERVER_ERROR : status;
    }
}
