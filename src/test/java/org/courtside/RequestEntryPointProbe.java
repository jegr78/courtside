package org.courtside;

import jakarta.servlet.Filter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.MethodParameter;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.lang.annotation.Annotation;
import java.util.Map;
import java.util.TreeSet;

class RequestEntryPointProbe extends AbstractIntegrationTest {

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private RequestMappingHandlerMapping mappings;

    @Autowired
    private Map<String, Filter> filterBeans;

    @Autowired
    private FilterChainProxy chainProxy;

    @Test
    void probe() {
        System.out.println("PROBE filter beans: " + new TreeSet<>(filterBeans.keySet()));
        for (SecurityFilterChain chain : chainProxy.getFilterChains()) {
            System.out.println("PROBE chain: " + chain.getFilters().stream()
                    .map(filter -> filter.getClass().getSimpleName()).toList());
        }
        mappings.getHandlerMethods().forEach((info, method) -> {
            TreeSet<String> inputs = new TreeSet<>();
            for (MethodParameter parameter : method.getMethodParameters()) {
                for (Annotation annotation : parameter.getParameterAnnotations()) {
                    inputs.add(annotation.annotationType().getSimpleName() + " "
                            + parameter.getParameterType().getSimpleName());
                }
                if (parameter.getParameterAnnotations().length == 0) {
                    inputs.add("bare " + parameter.getParameterType().getSimpleName());
                }
            }
            System.out.println("PROBE mapping " + describe(info, method) + " consumes="
                    + info.getConsumesCondition() + " inputs=" + inputs);
        });
    }

    private static String describe(RequestMappingInfo info, HandlerMethod method) {
        return info.getMethodsCondition() + " " + info.getPathPatternsCondition()
                + " @" + method.getBeanType().getSimpleName();
    }
}
