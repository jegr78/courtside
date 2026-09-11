package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.regex.Pattern;

// The refusal is reported rather than written, so the error dispatch answers it through the same
// chain every other refusal passes -- the one that writes the response headers.
@Component
class RefusesAmbiguity {

    static final String DETAIL = RefusesAmbiguity.class.getName() + ".detail";

    // A name is echoed only when it could not itself be the payload, because the answer to an
    // ambiguous request must not become a way to write arbitrary text back to its sender.
    private static final Pattern QUOTABLE = Pattern.compile("[A-Za-z0-9_.-]{1,64}");

    void report(HttpServletRequest request, HttpServletResponse response, String what, String name)
            throws IOException {
        request.setAttribute(DETAIL, QUOTABLE.matcher(name).matches()
                ? "The request names the %s %s more than once".formatted(what, name)
                : "The request names a %s more than once".formatted(what));
        response.sendError(HttpStatus.BAD_REQUEST.value());
    }
}
