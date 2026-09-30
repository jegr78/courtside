package org.courtside.shared.web;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Map;

// Spring reads an empty value as an absent one, so an optional parameter would silently take its default.
@Component
class RefusesEmptyParameters implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (request.getDispatcherType() != DispatcherType.REQUEST || !(handler instanceof HandlerMethod method)) {
            return true;
        }
        Map<String, Boolean> declared = DeclaredParameters.of(method);
        for (QueryString.Parameter parameter : QueryString.of(request)) {
            if (parameter.value().isEmpty() && Boolean.FALSE.equals(declared.get(parameter.name()))) {
                throw new EmptyParameterException(parameter.name());
            }
        }
        return true;
    }
}
