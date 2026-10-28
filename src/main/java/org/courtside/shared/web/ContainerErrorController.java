package org.courtside.shared.web;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.webmvc.autoconfigure.DispatcherServletPath;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.server.RequestPath;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.net.URI;
import java.util.stream.Collectors;

@Slf4j
@RestController
class ContainerErrorController implements ErrorController {

    private final ProblemTraceReference traceReference;
    private final RequestMappingHandlerMapping mappings;
    private final DispatcherServletPath servletPath;

    ContainerErrorController(ProblemTraceReference traceReference,
                             @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings,
                             DispatcherServletPath servletPath) {
        this.traceReference = traceReference;
        this.mappings = mappings;
        this.servletPath = servletPath;
    }

    @RequestMapping("${server.error.path:/error}")
    ResponseEntity<ProblemDetail> handleContainerError(HttpServletRequest request, HttpServletResponse response) {
        HttpStatus status = statusOf(request);
        ProblemDetail problem = request.getAttribute(RefusesAmbiguity.DETAIL) instanceof String detail
                ? ambiguous(detail)
                : problemFor(status);
        if (request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI) instanceof String requestUri) {
            problem.setInstance(URI.create(requestUri));
            if (problem.getStatus() == HttpStatus.METHOD_NOT_ALLOWED.value()) {
                response.setHeader("Allow", allowedMethods(request, requestUri));
            }
        }
        traceReference.addTo(problem);
        log.debug("Answering {} for {}", status, problem.getType());
        return ResponseEntity.status(HttpStatus.valueOf(problem.getStatus()))
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    private String allowedMethods(HttpServletRequest request, String requestUri) {
        String prefix = request.getContextPath() + servletPath.getPrefix();
        if (!requestUri.equals(prefix) && !requestUri.startsWith(prefix + "/")) {
            return "";
        }
        var path = RequestPath.parse(requestUri, prefix).pathWithinApplication();
        return mappings.getHandlerMethods().keySet().stream()
                .filter(mapping -> mapping.getPathPatternsCondition() != null
                        && mapping.getPathPatternsCondition().getPatterns().stream()
                        .anyMatch(pattern -> pattern.matches(path)))
                .flatMap(mapping -> mapping.getMethodsCondition().getMethods().stream())
                .map(Enum::name)
                .distinct().sorted()
                .collect(Collectors.joining(", "));
    }

    private static ProblemDetail ambiguous(String detail) {
        ProblemDetail problem =
                ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, detail);
        problem.setType(URI.create("urn:courtside:error:ambiguous-parameter"));
        problem.setTitle("Ambiguous parameter");
        return problem;
    }

    static ProblemDetail problemFor(HttpStatus status) {
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
        if (status == HttpStatus.NOT_IMPLEMENTED) {
            ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                    status, "This request asks for something this server does not implement");
            problem.setType(URI.create("urn:courtside:error:not-implemented"));
            problem.setTitle("Not implemented");
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
                status, "This request was rejected before any operation ran");
        problem.setType(URI.create("urn:courtside:error:request-rejected"));
        problem.setTitle("Request rejected");
        return problem;
    }

    private static HttpStatus statusOf(HttpServletRequest request) {
        return request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) instanceof Integer code
                ? resolve(code)
                : HttpStatus.INTERNAL_SERVER_ERROR;
    }

    static HttpStatus resolve(int status) {
        HttpStatus resolved = HttpStatus.resolve(status);
        return resolved == null ? HttpStatus.INTERNAL_SERVER_ERROR : resolved;
    }
}
