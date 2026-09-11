package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.util.StringUtils;

import java.util.Map;

final class Multipart {

    private Multipart() {
    }

    static boolean carriedBy(HttpServletRequest request) {
        return StringUtils.startsWithIgnoreCase(request.getContentType(), "multipart/");
    }

    static String firstRepeatedParameter(HttpServletRequest request) {
        for (Map.Entry<String, String[]> parameter : request.getParameterMap().entrySet()) {
            if (parameter.getValue().length > 1) {
                return parameter.getKey();
            }
        }
        return null;
    }
}
