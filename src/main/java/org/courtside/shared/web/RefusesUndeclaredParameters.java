package org.courtside.shared.web;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

// An OPTIONS request is answered by Spring's own handler, which declares none of the operation's parameters.
@Component
class RefusesUndeclaredParameters implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String query = request.getQueryString();
        if (query == null || query.isEmpty() || request.getDispatcherType() != DispatcherType.REQUEST
                || HttpMethod.OPTIONS.matches(request.getMethod()) || !(handler instanceof HandlerMethod method)) {
            return true;
        }
        Set<String> declared = declaredNames(method);
        for (String pair : query.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int separator = pair.indexOf('=');
            String name = URLDecoder.decode(separator < 0 ? pair : pair.substring(0, separator),
                    StandardCharsets.UTF_8);
            if (!declared.contains(name)) {
                throw new UndeclaredParameterException(name);
            }
        }
        return true;
    }

    private static Set<String> declaredNames(HandlerMethod method) {
        Set<String> names = new HashSet<>();
        for (MethodParameter parameter : method.getMethodParameters()) {
            RequestParam declared = parameter.getParameterAnnotation(RequestParam.class);
            if (declared != null) {
                names.add(!declared.name().isEmpty() ? declared.name()
                        : !declared.value().isEmpty() ? declared.value() : parameter.getParameterName());
            }
        }
        return names;
    }
}
