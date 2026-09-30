package org.courtside.shared.web;

import org.springframework.core.MethodParameter;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.method.HandlerMethod;

import java.util.HashMap;
import java.util.Map;

final class DeclaredParameters {

    private DeclaredParameters() {
    }

    static Map<String, Boolean> of(HandlerMethod method) {
        Map<String, Boolean> required = new HashMap<>();
        for (MethodParameter parameter : method.getMethodParameters()) {
            RequestParam declared = parameter.getParameterAnnotation(RequestParam.class);
            if (declared != null) {
                String name = !declared.name().isEmpty() ? declared.name()
                        : !declared.value().isEmpty() ? declared.value() : parameter.getParameterName();
                required.put(name, declared.required());
            }
        }
        return required;
    }
}
