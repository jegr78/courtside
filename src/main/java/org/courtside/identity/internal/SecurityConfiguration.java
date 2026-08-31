package org.courtside.identity.internal;

import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;

import jakarta.servlet.DispatcherType;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RegexRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({BootstrapAdminProperties.class, CredentialIssueProperties.class,
        LoginProtectionProperties.class})
public class SecurityConfiguration {

    // OWASP's Argon2id minimum; the login filter limits how often a caller can incur this cost.
    private static final int MEMORY_IN_KIBIBYTES = 19456;
    private static final int ITERATIONS = 2;
    private static final int PARALLELISM = 1;
    private static final int SALT_LENGTH_IN_BYTES = 16;
    private static final int HASH_LENGTH_IN_BYTES = 32;
    private static final String LOGIN_PROCESSING_URL = "/api/session";

    private static RequestMatcher loginEndpoint() {
        return PathPatternRequestMatcher.withDefaults()
                .matcher(HttpMethod.POST, LOGIN_PROCESSING_URL);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new Argon2PasswordEncoder(SALT_LENGTH_IN_BYTES, HASH_LENGTH_IN_BYTES,
                PARALLELISM, MEMORY_IN_KIBIBYTES, ITERATIONS);
    }

    @Bean
    public SecurityFilterChain filterChain(
            HttpSecurity http,
            ProblemDetailAccessDeniedHandler accessDeniedHandler,
            ProblemDetailAuthenticationEntryPoint authenticationEntryPoint,
            LoginAttemptProtection loginAttemptProtection,
            LoginRateLimitHandler loginRateLimitHandler,
            UserAccountRepository accounts,
            @Value("${courtside.performance.telemetry-enabled:false}") boolean performanceTelemetryEnabled,
            @Value("${server.servlet.session.cookie.secure}") boolean secureCookies)
            throws Exception {
        CsrfTokenRequestAttributeHandler csrfHandler = new CsrfTokenRequestAttributeHandler();
        csrfHandler.setCsrfRequestAttributeName(null);

        return http
                .authorizeHttpRequests(auth -> auth
                        // The error dispatch is the tail of a request already decided, not a new one.
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers("/api/public/booking-cards", "/api/public/participant-cards",
                                "/api/public/participant-members")
                        .access((authentication, context) -> new AuthorizationDecision(
                                isAuthenticated(authentication.get())
                                        && !hasAuthority(authentication.get(),
                                        CourtsideUserDetailsService.PASSWORD_CHANGE_REQUIRED)))
                        .requestMatchers("/api/public/**", "/actuator/health").permitAll()
                        .requestMatchers("/actuator/health/**").access((authentication, context) ->
                                new AuthorizationDecision(hasAuthority(authentication.get(),
                                        "ROLE_" + Role.ADMIN.name())
                                        && !hasAuthority(authentication.get(),
                                        CourtsideUserDetailsService.PASSWORD_CHANGE_REQUIRED)))
                        .requestMatchers(HttpMethod.GET, "/api/bookings").permitAll()
                        .requestMatchers("/actuator/prometheus").access((authentication, context) ->
                                new AuthorizationDecision(performanceTelemetryEnabled))
                        .requestMatchers("/api/openapi.yaml", "/api/source").permitAll()
                        .requestMatchers("/", "/courts", "/login", "/initial-password", "/my-bookings",
                                "/my-messages",
                                "/admin",
                                "/admin/configuration", "/admin/facility", "/admin/roster",
                                "/admin/roster/{personId}", "/admin/membership-types", "/admin/import",
                                "/admin/audit",
                                "/admin/messages",
                                "/index.html",
                                "/assets/**", "/icon.svg", "/manifest.webmanifest", "/sw.js",
                                "/workbox-*.js").permitAll()
                        .requestMatchers("/api/session").permitAll()
                        .requestMatchers("/api/session/logout").authenticated()
                        .requestMatchers("/api/account/initial-password").access(
                                (authentication, context) -> new AuthorizationDecision(
                                        hasAuthority(authentication.get(),
                                                CourtsideUserDetailsService.PASSWORD_CHANGE_REQUIRED)))
                        .requestMatchers(RegexRequestMatcher.regexMatcher(
                                "(?i)^/api/admin(?:/.*)?(?:\\?.*)?$")).access((authentication, context) ->
                                new AuthorizationDecision(hasAuthority(authentication.get(),
                                        "ROLE_" + Role.ADMIN.name())
                                        && !hasAuthority(authentication.get(),
                                        CourtsideUserDetailsService.PASSWORD_CHANGE_REQUIRED)))
                        .anyRequest().access((authentication, context) -> new AuthorizationDecision(
                                isAuthenticated(authentication.get())
                                        && !hasAuthority(authentication.get(),
                                        CourtsideUserDetailsService.PASSWORD_CHANGE_REQUIRED))))
                .formLogin(form -> form
                        .loginProcessingUrl(LOGIN_PROCESSING_URL)
                        .successHandler((request, response, authentication) -> {
                            loginAttemptProtection.clear(request.getRemoteAddr());
                            if (authentication.getAuthorities().stream().anyMatch(authority ->
                                    authority.getAuthority().equals(
                                            CourtsideUserDetailsService.PASSWORD_CHANGE_REQUIRED))) {
                                response.setHeader("X-Courtside-Password-Change-Required", "true");
                            }
                            response.setStatus(HttpStatus.OK.value());
                        })
                        .failureHandler(authenticationEntryPoint::commence))
                .addFilterBefore(new LoginAttemptFilter(loginEndpoint(), loginAttemptProtection,
                        loginRateLimitHandler), UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(new SecurityEpochFilter(accounts, authenticationEntryPoint),
                        SecurityContextHolderFilter.class)
                .logout(logout -> logout
                        .logoutUrl("/api/session/logout")
                        .logoutSuccessHandler((request, response, authentication) ->
                                response.setStatus(HttpStatus.NO_CONTENT.value())))
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfTokenRepository(secureCookies))
                        .csrfTokenRequestHandler(csrfHandler))
                .headers(headers -> headers
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'self'; object-src 'none'; img-src 'self' https:; "
                                        + "style-src 'self'; script-src 'self'; connect-src 'self'; "
                                        + "manifest-src 'self'; worker-src 'self'; "
                                        + "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"))
                        .frameOptions(frame -> frame.deny())
                        .referrerPolicy(referrer -> referrer.policy(
                                ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN)))
                .build();
    }

    static CookieCsrfTokenRepository csrfTokenRepository(boolean secureCookies) {
        CookieCsrfTokenRepository repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        repository.setCookieCustomizer(cookie -> cookie
                .secure(secureCookies)
                .sameSite("Lax"));
        return repository;
    }

    private static boolean hasAuthority(
            org.springframework.security.core.Authentication authentication, String authority) {
        return authentication.getAuthorities().stream()
                .anyMatch(granted -> granted.getAuthority().equals(authority));
    }

    private static boolean isAuthenticated(
            org.springframework.security.core.Authentication authentication) {
        return authentication.isAuthenticated()
                && !(authentication instanceof AnonymousAuthenticationToken);
    }
}
