package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

// Spring reads an empty value as an absent one, so an optional parameter would silently take its default.
@Component
class RefusesEmptyParameters implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) {
            return true;
        }
        for (MethodParameter parameter : method.getMethodParameters()) {
            RequestParam declared = parameter.getParameterAnnotation(RequestParam.class);
            if (declared == null || declared.required()) {
                continue;
            }
            String name = !declared.name().isEmpty() ? declared.name()
                    : !declared.value().isEmpty() ? declared.value() : parameter.getParameterName();
            String[] values = request.getParameterValues(name);
            if (values != null && values.length == 1 && values[0].isEmpty()) {
                throw new EmptyParameterException(name);
            }
        }
        return true;
    }
}
