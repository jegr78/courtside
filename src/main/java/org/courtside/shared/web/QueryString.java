package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class QueryString {

    record Parameter(String name, String value) {
    }

    private QueryString() {
    }

    static List<Parameter> of(HttpServletRequest request) {
        String query = request.getQueryString();
        List<Parameter> parameters = new ArrayList<>();
        if (query == null) {
            return parameters;
        }
        for (String pair : query.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int separator = pair.indexOf('=');
            parameters.add(new Parameter(decoded(separator < 0 ? pair : pair.substring(0, separator)),
                    separator < 0 ? "" : decoded(pair.substring(separator + 1))));
        }
        return parameters;
    }

    // A malformed escape stays as sent, so it names nothing any handler declares.
    private static String decoded(String text) {
        try {
            return URLDecoder.decode(text, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException malformed) {
            return text;
        }
    }
}
