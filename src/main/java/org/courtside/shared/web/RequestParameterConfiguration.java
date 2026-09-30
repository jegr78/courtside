package org.courtside.shared.web;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration(proxyBeanMethods = false)
@RequiredArgsConstructor
class RequestParameterConfiguration implements WebMvcConfigurer {

    private final RefusesEmptyParameters refusesEmptyParameters;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(refusesEmptyParameters);
    }
}
