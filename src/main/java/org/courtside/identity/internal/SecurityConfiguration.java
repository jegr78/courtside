package org.courtside.identity.internal;

import org.courtside.identity.CurrentUser;
import org.courtside.identity.Role;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.SecurityEventLog;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.session.SessionRegistry;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.DeferredCsrfToken;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RegexRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;

import java.net.URI;
import java.time.Clock;
import java.util.List;
import java.util.Set;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({BootstrapAdminProperties.class, CredentialIssueProperties.class,
        LoginProtectionProperties.class, CourtsideSessionProperties.class, PasswordPolicyProperties.class})
public class SecurityConfiguration {

    private static final URI HIBP_RANGE_ENDPOINT = URI.create("https://api.pwnedpasswords.com/range/");

    // OWASP's Argon2id minimum; the login filter limits how often a caller can incur this cost.
    private static final int MEMORY_IN_KIBIBYTES = 19456;
    private static final int ITERATIONS = 2;
    private static final int PARALLELISM = 1;
    private static final int SALT_LENGTH_IN_BYTES = 16;
    private static final int HASH_LENGTH_IN_BYTES = 32;
    private static final String LOGIN_PROCESSING_URL = "/api/session";

    private static RequestMatcher passwordVerificationEndpoints() {
        RequestMatcher login = loginEndpoint();
        RequestMatcher reauthentication = PathPatternRequestMatcher.withDefaults()
                .matcher(HttpMethod.POST, "/api/session/reauthentication");
        RequestMatcher initialPasswordChange = PathPatternRequestMatcher.withDefaults()
                .matcher(HttpMethod.PUT, "/api/account/initial-password");
        RequestMatcher passwordChange = PathPatternRequestMatcher.withDefaults()
                .matcher(HttpMethod.PUT, "/api/account/password");
        return request -> login.matches(request)
                || reauthentication.matches(request)
                || initialPasswordChange.matches(request)
                || passwordChange.matches(request);
    }

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
    BreachedPasswordLookup breachedPasswordLookup(PasswordPolicyProperties properties, Clock clock,
                                                   @Value("${courtside.environment}") String environment) {
        URI endpoint = properties.breachEndpoint();
        if ("PRODUCTION".equalsIgnoreCase(environment) && !HIBP_RANGE_ENDPOINT.equals(endpoint)) {
            throw new IllegalStateException(
                    "COURTSIDE_PASSWORD_BREACH_ENDPOINT cannot override HIBP in production");
        }
        if (!Set.of("http", "https").contains(endpoint.getScheme()) || endpoint.getUserInfo() != null
                || endpoint.getQuery() != null || endpoint.getFragment() != null
                || !endpoint.getPath().endsWith("/")) {
            throw new IllegalStateException(
                    "COURTSIDE_PASSWORD_BREACH_ENDPOINT must be an HTTP range base ending in '/'");
        }
        return new HaveIBeenPwnedPasswordLookup(
                endpoint,
                properties.breachTimeout(), properties.breachCacheEntries(),
                properties.breachCacheLifetime(), clock);
    }

    @Bean
    public SecurityFilterChain filterChain(
            HttpSecurity http,
            ProblemDetailAccessDeniedHandler accessDeniedHandler,
            ProblemDetailAuthenticationEntryPoint authenticationEntryPoint,
            LoginAttemptProtection loginAttemptProtection,
            @Qualifier("loginVerificationCapacity") LoginVerificationCapacity loginVerificationCapacity,
            @Qualifier("credentialVerificationCapacity")
            LoginVerificationCapacity credentialVerificationCapacity,
            LoginRateLimitHandler loginRateLimitHandler,
            SecurityEventLog securityEvents,
            CurrentUser currentUser,
            RecentAuthentication recentAuthentication,
            UserAccountRepository accounts,
            CourtsideSessionProperties sessionPolicy,
            SessionRegistry sessionRegistry,
            CookieSerializer sessionCookieSerializer,
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
                                "/my-messages", "/account/security",
                                "/admin", "/admin/setup",
                                "/admin/configuration", "/admin/facility",
                                "/admin/facility/courts", "/admin/facility/opening-hours",
                                "/admin/facility/booking-cards",
                                "/admin/facility/booking-cards/{cardId}",
                                "/admin/facility/slot-fillers",
                                "/admin/roster",
                                "/admin/roster/{personId}", "/admin/membership-types", "/admin/import",
                                "/admin/export", "/admin/utilisation",
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
                        .authenticationDetailsSource(request -> null)
                        .successHandler((request, response, authentication) -> {
                            request.getSession(true).setAttribute(AccountSessionService.BROWSER_FAMILY,
                                    AccountSessionService.browserFamily(
                                            request.getHeader("User-Agent")).name());
                            if (authentication.getPrincipal() instanceof CourtsideUserDetails user) {
                                securityEvents.authenticationSucceeded(user.accountId());
                                recentAuthentication.record(request);
                            }
                            if (authentication.getAuthorities().stream().anyMatch(authority ->
                                    authority.getAuthority().equals(
                                            CourtsideUserDetailsService.PASSWORD_CHANGE_REQUIRED))) {
                                response.setHeader("X-Courtside-Password-Change-Required", "true");
                            }
                            response.setStatus(HttpStatus.OK.value());
                        })
                        .failureHandler(authenticationEntryPoint::commence))
                .addFilterBefore(new LoginAttemptFilter(loginEndpoint(), passwordVerificationEndpoints(),
                        loginAttemptProtection, loginVerificationCapacity, credentialVerificationCapacity,
                        loginRateLimitHandler, securityEvents, currentUser),
                        UsernamePasswordAuthenticationFilter.class)
                // The default only changes the session id, which keeps the creation time the absolute
                // lifetime counts from, so a second member on a shared browser inherits the first's.
                .sessionManagement(session -> session
                        .sessionFixation(fixation -> fixation.migrateSession())
                        .maximumSessions(sessionPolicy.concurrentLimit())
                        .sessionRegistry(sessionRegistry)
                        // The oldest inactive session goes rather than the sign-in being refused: a
                        // member who cannot reach a device is not helped by being locked out of it.
                        .maxSessionsPreventsLogin(false))
                .addFilterAfter(new SecurityEpochFilter(accounts, securityEvents),
                        SecurityContextHolderFilter.class)
                // Anchored behind the epoch filter: two filters sharing one anchor are ordered by
                // nothing but the order they were added here.
                .addFilterAfter(new AbsoluteSessionLifetimeFilter(sessionPolicy.absoluteLifetime(), securityEvents),
                        SecurityEpochFilter.class)
                .addFilterAfter(new InvalidSessionCookieFilter(sessionCookieSerializer),
                        AbsoluteSessionLifetimeFilter.class)
                .logout(logout -> logout
                        .logoutUrl("/api/session/logout")
                        .logoutSuccessHandler((request, response, authentication) -> {
                            if (authentication != null
                                    && authentication.getPrincipal() instanceof CourtsideUserDetails user) {
                                securityEvents.sessionTerminated(user.accountId(), user.accountId(),
                                        SecurityEventLog.SessionTermination.EXPLICIT_LOGOUT);
                            }
                            response.setStatus(HttpStatus.NO_CONTENT.value());
                        }))
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
                                + "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"))
                        .frameOptions(frame -> frame.deny())
                        .referrerPolicy(referrer -> referrer.policy(
                                ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN)))
                .build();
    }

    @Bean("loginVerificationCapacity")
    LoginVerificationCapacity loginVerificationCapacity(LoginProtectionProperties properties) {
        return new LoginVerificationCapacity(properties);
    }

    @Bean("credentialVerificationCapacity")
    LoginVerificationCapacity credentialVerificationCapacity(LoginProtectionProperties properties) {
        return new LoginVerificationCapacity(properties);
    }

    @Bean
    <S extends Session> SessionRegistry sessionRegistry(FindByIndexNameSessionRepository<S> sessions,
                                                        UserAccountRepository accounts,
                                                        SecurityEventLog securityEvents) {
        return new DisplacingSessionRegistry<>(sessions, accounts, securityEvents);
    }

    static CsrfTokenRepository csrfTokenRepository(boolean secureCookies) {
        return new TransportAwareCsrfTokenRepository(secureCookies);
    }

    @Bean
    public CookieSerializer configuredSessionCookieSerializer(
            @Value("${server.servlet.session.cookie.secure}") boolean secureCookies,
            @Value("${courtside.environment}") String environment) {
        validateCookiePolicy(secureCookies, environment);
        return sessionCookieSerializer(secureCookies);
    }

    static void validateCookiePolicy(boolean secureCookies, String environment) {
        if (!secureCookies && "PRODUCTION".equalsIgnoreCase(environment)) {
            throw new IllegalStateException(
                    "COURTSIDE_COOKIE_SECURE=false is reserved for a non-production local or test environment");
        }
    }

    static CookieSerializer sessionCookieSerializer(boolean secureCookies) {
        return new TransportAwareCookieSerializer(secureCookies);
    }

    private static CsrfTokenRepository csrfTokenRepositoryFor(boolean secureCookies) {
        CookieCsrfTokenRepository repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        repository.setCookieName(secureCookies ? "__Host-XSRF-TOKEN" : "XSRF-TOKEN");
        repository.setCookieCustomizer(cookie -> cookie
                .secure(secureCookies)
                .sameSite("Lax"));
        return repository;
    }

    private static final class TransportAwareCookieSerializer implements CookieSerializer {

        private final boolean forceSecure;
        private final CookieSerializer secure = cookieSerializer("__Host-SESSION", true);
        private final CookieSerializer local = cookieSerializer("SESSION", false);

        private TransportAwareCookieSerializer(boolean forceSecure) {
            this.forceSecure = forceSecure;
        }

        @Override
        public void writeCookieValue(CookieValue cookieValue) {
            delegate(cookieValue.getRequest()).writeCookieValue(cookieValue);
        }

        @Override
        public List<String> readCookieValues(HttpServletRequest request) {
            return delegate(request).readCookieValues(request);
        }

        private CookieSerializer delegate(HttpServletRequest request) {
            return forceSecure || request.isSecure() ? secure : local;
        }

        private static CookieSerializer cookieSerializer(String name, boolean secure) {
            DefaultCookieSerializer serializer = new DefaultCookieSerializer();
            serializer.setCookieName(name);
            serializer.setCookiePath("/");
            serializer.setUseSecureCookie(secure);
            serializer.setUseHttpOnlyCookie(true);
            serializer.setSameSite("Lax");
            return serializer;
        }
    }

    private static final class TransportAwareCsrfTokenRepository implements CsrfTokenRepository {

        private final boolean forceSecure;
        private final CsrfTokenRepository secure = csrfTokenRepositoryFor(true);
        private final CsrfTokenRepository local = csrfTokenRepositoryFor(false);

        private TransportAwareCsrfTokenRepository(boolean forceSecure) {
            this.forceSecure = forceSecure;
        }

        @Override
        public CsrfToken generateToken(HttpServletRequest request) {
            return delegate(request).generateToken(request);
        }

        @Override
        public void saveToken(CsrfToken token, HttpServletRequest request, HttpServletResponse response) {
            delegate(request).saveToken(token, request, response);
        }

        @Override
        public CsrfToken loadToken(HttpServletRequest request) {
            return delegate(request).loadToken(request);
        }

        @Override
        public DeferredCsrfToken loadDeferredToken(HttpServletRequest request, HttpServletResponse response) {
            return delegate(request).loadDeferredToken(request, response);
        }

        private CsrfTokenRepository delegate(HttpServletRequest request) {
            return forceSecure || request.isSecure() ? secure : local;
        }
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
