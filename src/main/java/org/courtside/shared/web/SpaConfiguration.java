package org.courtside.shared.web;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import jakarta.servlet.http.HttpServletResponse;
import org.courtside.shared.ApplicationShellText;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.autoconfigure.web.WebProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler;
import org.springframework.web.util.HtmlUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;

@Slf4j
@Configuration(proxyBeanMethods = false)
class SpaConfiguration {

    private static final String SHELL_DOCUMENT = "index.html";

    // Ahead of Boot's welcome page, which would otherwise answer "/" with a forward.
    private static final int SHELL_ORDER = 1;

    static final List<String> SHELL_ROUTES = List.of(
            "/",
            "/courts",
            "/account-recovery",
            "/register",
            "/registration/verify",
            "/login",
            "/initial-password",
            "/my-bookings",
            "/my-messages",
            "/my-dependants",
            "/account",
            "/account/security",
            "/admin",
            "/admin/appointments",
            "/admin/setup",
            "/admin/configuration",
            "/admin/deadlines",
            "/admin/rule-sets",
            "/admin/message-wording",
            "/admin/facility",
            "/admin/facility/courts",
            "/admin/facility/access-points",
            "/admin/facility/opening-hours",
            "/admin/facility/opening-hours/exceptions",
            "/admin/facility/booking-cards",
            "/admin/facility/booking-cards/{cardId}",
            "/admin/facility/slot-fillers",
            "/admin/roster",
            "/admin/roster/{personId}",
            "/admin/membership-types",
            "/admin/import",
            "/admin/export",
            "/admin/retention",
            "/admin/utilisation",
            "/admin/usage",
            "/admin/audit",
            "/admin/messages",
            "/admin/operational-logs",
            "/admin/access-grants",
            "/admin/operator-health",
            "/admin/guest-fees",
            "/admin/credit");

    @Bean
    SimpleUrlHandlerMapping applicationShellMapping(ApplicationShell shell) {
        Map<String, Object> routes = new LinkedHashMap<>();
        SHELL_ROUTES.forEach(route -> routes.put(route, shell));
        return new SimpleUrlHandlerMapping(routes, SHELL_ORDER);
    }

    // Every file the build writes below assets/ carries a content hash, so a changed file is a new URL.
    @Bean
    WebMvcConfigurer contentHashedAssets(WebProperties web) {
        return new WebMvcConfigurer() {
            @Override
            public void addResourceHandlers(ResourceHandlerRegistry registry) {
                registry.addResourceHandler("/assets/**")
                        .addResourceLocations(Arrays.stream(web.getResources().getStaticLocations())
                                .map(location -> location + "assets/").toArray(String[]::new))
                        .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable());
            }
        };
    }

    @Bean
    ApplicationShell applicationShell(WebProperties web, ApplicationShellText clubText) {
        ApplicationShell shell = new ApplicationShell(clubText);
        WebProperties.Resources.Cache cache = web.getResources().getCache();
        shell.setLocationValues(List.of(web.getResources().getStaticLocations()));
        // The club's text changes without the file changing, so the file's date says nothing about it.
        shell.setUseLastModified(false);
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

        private final ApplicationShellText clubText;

        ApplicationShell(ApplicationShellText clubText) {
            this.clubText = clubText;
        }

        @Override
        protected @Nullable Resource getResource(HttpServletRequest request) throws IOException {
            for (Resource location : getLocations()) {
                Resource document = location.createRelative(SHELL_DOCUMENT);
                if (document.isReadable()) {
                    String shell = document.getContentAsString(StandardCharsets.UTF_8);
                    ApplicationShellText.Text text = clubText.current();
                    return new ShellDocument(withClubText(shell, text.language(), text.description())
                            .getBytes(StandardCharsets.UTF_8));
                }
            }
            return null;
        }

        static String withClubText(String shell, String language, String description) {
            if (!shell.contains("<html lang=\"") || !shell.contains("</title>")) {
                log.warn("The application shell has no <html lang> or <title> to carry the club's description");
                return shell;
            }
            return shell.replaceFirst("<html lang=\"[^\"]*\">",
                            Matcher.quoteReplacement("<html lang=\"" + attribute(language) + "\">"))
                    .replaceFirst("</title>", Matcher.quoteReplacement(
                            "</title>\n    <meta name=\"description\" content=\"" + attribute(description) + "\" />"));
        }

        private static String attribute(String value) {
            return HtmlUtils.htmlEscape(value, StandardCharsets.UTF_8.name());
        }

        @Override
        protected void setHeaders(HttpServletResponse response, Resource resource, @Nullable MediaType mediaType)
                throws IOException {
            super.setHeaders(response, resource, mediaType);
            // The shell states the language the locale resolver chose, as a rendered view does.
            response.setLocale(LocaleContextHolder.getLocale());
        }
    }

    private static final class ShellDocument extends ByteArrayResource {

        private ShellDocument(byte[] content) {
            super(content);
        }

        @Override
        public String getFilename() {
            return SHELL_DOCUMENT;
        }
    }
}
