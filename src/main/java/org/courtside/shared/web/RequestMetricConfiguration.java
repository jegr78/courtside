package org.courtside.shared.web;

import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.micrometer.metrics.autoconfigure.MetricsProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Map;
import java.util.Set;

@Configuration(proxyBeanMethods = false)
class RequestMetricConfiguration {

    // Routes the framework serves beside the API and the shell, and the values for an unmatched request.
    static final Set<String> FRAMEWORK_URIS = Set.of(
            "/**", "/webjars/**", "/error",
            "/actuator", "/actuator/health", "/actuator/health/**", "/actuator/prometheus",
            "REDIRECTION", "NOT_FOUND", "root", "UNKNOWN");

    @Bean
    static BeanPostProcessor requestTimerForEveryRoute() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                if (bean instanceof MetricsProperties metrics) {
                    MetricsProperties.Web.Server server = metrics.getWeb().getServer();
                    server.setMaxUriTags(Math.max(server.getMaxUriTags(), servedRoutes()));
                }
                return bean;
            }
        };
    }

    static int servedRoutes() {
        return declaredApiPaths() + SpaConfiguration.SHELL_ROUTES.size() + FRAMEWORK_URIS.size();
    }

    private static int declaredApiPaths() {
        try (InputStream document = new ClassPathResource("api/openapi.yaml").getInputStream()) {
            Map<?, ?> api = new Yaml().load(document);
            return ((Map<?, ?>) api.get("paths")).size();
        } catch (IOException unreadable) {
            throw new UncheckedIOException("The API document must ship on the classpath", unreadable);
        }
    }
}
