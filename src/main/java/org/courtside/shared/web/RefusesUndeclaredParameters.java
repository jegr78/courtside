package org.courtside.shared.web;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Set;

// An OPTIONS request is answered by Spring's own handler, which declares none of the operation's parameters.
@Component
class RefusesUndeclaredParameters implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (request.getDispatcherType() != DispatcherType.REQUEST || HttpMethod.OPTIONS.matches(request.getMethod())
                || !(handler instanceof HandlerMethod method)) {
            return true;
        }
        Set<String> declared = DeclaredParameters.of(method).keySet();
        for (QueryString.Parameter parameter : QueryString.of(request)) {
            if (!declared.contains(parameter.name())) {
                throw new UndeclaredParameterException(parameter.name());
            }
        }
        return true;
    }
}
