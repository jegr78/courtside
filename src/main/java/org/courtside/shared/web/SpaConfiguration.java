package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.autoconfigure.web.WebProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Configuration(proxyBeanMethods = false)
class SpaConfiguration {

    private static final String SHELL_DOCUMENT = "index.html";

    // Ahead of Boot's welcome page, which would otherwise answer "/" with a forward.
    private static final int SHELL_ORDER = 1;

    private static final List<String> SHELL_ROUTES = List.of(
            "/",
            "/courts",
            "/account-recovery",
            "/login",
            "/initial-password",
            "/my-bookings",
            "/my-messages",
            "/account/security",
            "/admin",
            "/admin/appointments",
            "/admin/setup",
            "/admin/configuration",
            "/admin/deadlines",
            "/admin/rule-sets",
            "/admin/facility",
            "/admin/facility/courts",
            "/admin/facility/opening-hours",
            "/admin/facility/booking-cards",
            "/admin/facility/booking-cards/{cardId}",
            "/admin/facility/slot-fillers",
            "/admin/roster",
            "/admin/roster/{personId}",
            "/admin/membership-types",
            "/admin/import",
            "/admin/export",
            "/admin/utilisation",
            "/admin/audit",
            "/admin/messages",
            "/admin/operational-logs");

    @Bean
    SimpleUrlHandlerMapping applicationShellMapping(ApplicationShell shell) {
        Map<String, Object> routes = new LinkedHashMap<>();
        SHELL_ROUTES.forEach(route -> routes.put(route, shell));
        return new SimpleUrlHandlerMapping(routes, SHELL_ORDER);
    }

    @Bean
    ApplicationShell applicationShell(WebProperties web) {
        ApplicationShell shell = new ApplicationShell();
        WebProperties.Resources.Cache cache = web.getResources().getCache();
        shell.setLocationValues(List.of(web.getResources().getStaticLocations()));
        shell.setUseLastModified(cache.isUseLastModified());
        if (cache.getPeriod() != null) {
            shell.setCacheSeconds((int) cache.getPeriod().toSeconds());
        }
        CacheControl cacheControl = cache.getCachecontrol().toHttpCacheControl();
        if (cacheControl != null) {
            shell.setCacheControl(cacheControl);
        }
        return shell;
    }

    static final class ApplicationShell extends ResourceHttpRequestHandler {

        @Override
        protected @Nullable Resource getResource(HttpServletRequest request) throws IOException {
            for (Resource location : getLocations()) {
                Resource document = location.createRelative(SHELL_DOCUMENT);
                if (document.isReadable()) {
                    return document;
                }
            }
            return null;
        }

        @Override
        protected void setHeaders(HttpServletResponse response, Resource resource, @Nullable MediaType mediaType)
                throws IOException {
            super.setHeaders(response, resource, mediaType);
            // The shell states the language the locale resolver chose, as a rendered view does.
            response.setLocale(LocaleContextHolder.getLocale());
        }
    }
}
