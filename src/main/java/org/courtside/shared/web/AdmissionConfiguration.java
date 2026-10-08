package org.courtside.shared.web;

import org.courtside.shared.SecurityEventLog;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import tools.jackson.databind.ObjectMapper;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AdmissionProperties.class)
class AdmissionConfiguration {

    @Bean
    AdmissionControl admissionControl(AdmissionProperties properties, ObjectMapper json,
                                      SecurityEventLog securityEvents) {
        return new AdmissionControl(AdmissionPlan.load(properties, json),
                new RequestBudgets(properties.trackedPrincipals(), System::nanoTime), properties, securityEvents);
    }

    @Bean
    WebMvcConfigurer admissionBeforeEveryHandler(AdmissionControl admissionControl) {
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                registry.addInterceptor(admissionControl).order(Ordered.HIGHEST_PRECEDENCE);
            }
        };
    }
}
