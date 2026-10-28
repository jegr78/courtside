package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.util.ServletRequestPathUtils;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Predicate;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AdminSurfaceTest extends AbstractIntegrationTest {

    private static final String API_DOCUMENT = "/api/openapi.yaml";

    private static final Set<String> HTTP_METHODS =
            Set.of("get", "put", "post", "delete", "patch", "options", "head", "trace");

    private static final String CATCH_ALL_UUID = "11111111-1111-1111-1111-111111111111";

    private static final String BOOT_ERROR_PATH = "/error";
    private static final String INITIAL_PASSWORD_PATH = "/api/account/initial-password";

    // A variable missing here is checked against the catch-all UUID it was given, which proves nothing.
    private static final Map<String, String> EXPECTED_LITERAL_BY_VARIABLE = Map.of(
            "day", "MONDAY",
            "ruleType", "ADVANCE_WINDOW");

    private static final Set<String> ANONYMOUS_ALLOWED_PATHS = Set.of(
            "/api/account-recovery/password",
            "/api/account-recovery/password/redemption",
            "/api/account-recovery/mfa/redemption",
            "/api/account-recovery/usernames",
            "/api/openapi.yaml",
            "/api/public/booking-card-legend",
            "/api/public/booking-grid",
            "/api/public/config",
            "/api/public/config/icon",
            "/api/public/config/logo",
            "/api/public/courts",
            "/api/public/opening-hours",
            "/api/reserved-slots",
            "/api/session",
            "/api/session/mfa",
            "/api/session/mfa/webauthn",
            "/api/session/mfa/webauthn/options",
            "/api/source",
            "/manifest.webmanifest");

    private static final Set<String> AUTHENTICATED_PATHS = Set.of(
            "/api/account/locale",
            "/api/account/mfa",
            "/api/account/mfa/totp",
            "/api/account/mfa/totp/confirmation",
            "/api/account/mfa/recovery-codes",
            "/api/account/mfa/webauthn",
            "/api/account/mfa/webauthn/registration-options",
            "/api/account/mfa/webauthn/authentication-options",
            "/api/account/mfa/webauthn/credentials/{credentialId}",
            "/api/account/messages",
            "/api/account/messages/channels",
            "/api/account/notifications",
            "/api/account/notifications/{notificationId}/read",
            "/api/account/password",
            "/api/account/sessions",
            "/api/account/sessions/{sessionHandle}",
            "/api/session/reauthentication",
            "/api/public/booking-cards",
            "/api/public/participant-cards",
            "/api/public/participant-members",
            "/api/my/bookings",
            "/api/my/participations",
            "/api/my/participations/{bookingId}",
            "/api/managed/bookings",
            "/api/managed/bookings/{id}",
            "/api/bookings",
            "/api/booking-eligibility",
            "/api/bookings/{id}",
            "/api/booking-series",
            "/api/booking-series-preview",
            "/api/booking-series/{id}",
            "/api/booking-series/{id}/move",
            "/api/booking-series/{id}/move/preview",
            "/api/my/waitlist",
            "/api/my/waitlist/{entryId}",
            "/api/my/waitlist/{entryId}/acceptance",
            "/api/my/dependants",
            "/api/my/dependants/{personId}/bookings",
            "/api/my/dependants/{personId}/bookings/{bookingId}",
            "/api/my/dependants/{personId}/notifications",
            "/api/my/dependants/{personId}/credentials",
            "/api/my/bookings/{bookingId}/partner-invitation",
            "/api/my/bookings/{bookingId}/check-in",
            "/api/partner-invitations",
            "/api/partner-invitations/{invitationId}/acceptance");

    private static final Set<String> RECENT_AUTHENTICATION_ENDPOINTS = Set.of(
            "DELETE /api/account/sessions",
            "POST /api/account/mfa/totp",
            "POST /api/account/mfa/totp/confirmation",
            "POST /api/account/mfa/recovery-codes",
            "DELETE /api/account/mfa/totp",
            "DELETE /api/account/mfa",
            "POST /api/account/mfa/webauthn/registration-options",
            "PATCH /api/account/mfa/webauthn/credentials/{credentialId}",
            "DELETE /api/account/mfa/webauthn/credentials/{credentialId}");

    private static final Set<String> MFA_PROOF_REQUIRED_ENDPOINTS = Set.of(
            "POST /api/session/mfa",
            "POST /api/session/mfa/webauthn",
            "POST /api/session/mfa/webauthn/options",
            "POST /api/account/mfa/webauthn",
            "POST /api/account/mfa/webauthn/authentication-options");

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private RequestMappingHandlerMapping handlerMapping;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private UserDetailsService users;

    private MockMvc mockMvc;
    private UserDetails member;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        Person person = persons.save(new Person("Jane", "Doe", "doe.jane@example.org"));
        UserAccount account = new UserAccount(
                person, "doe.jane", passwordEncoder.encode("secret"), Set.of(Role.MEMBER), "de");
        account.enable();
        accounts.save(account);
        member = users.loadUserByUsername(account.getUsername());
    }

    @Test
    void whenEveryMappedPathIsInspected_thenItIsClassifiedAsAdminAnonymousOrAuthenticated() {
        // given
        assertThat(ANONYMOUS_ALLOWED_PATHS)
                .as("a path cannot be both anonymous-allowed and authenticated-only")
                .doesNotContainAnyElementsOf(AUTHENTICATED_PATHS);
        assertThat(endpointsMatching(pattern -> true).stream()
                        .map(endpoint -> endpoint.method() + " " + endpoint.pattern()))
                .as("every declared recent-authentication exception must name a mapped endpoint")
                .containsAll(RECENT_AUTHENTICATION_ENDPOINTS)
                .containsAll(MFA_PROOF_REQUIRED_ENDPOINTS);

        List<String> mapped = mappedPatterns();

        // when
        List<String> unclassified = mapped.stream()
                .filter(pattern -> !pattern.equals(BOOT_ERROR_PATH))
                .filter(pattern -> !isPrivileged(pattern))
                .filter(pattern -> !ANONYMOUS_ALLOWED_PATHS.contains(pattern))
                .filter(pattern -> !AUTHENTICATED_PATHS.contains(pattern))
                .toList();

        // then
        assertThat(unclassified).isEmpty();
    }

    @Test
    void givenAMember_whenCallingEveryAdminEndpoint_thenEveryOneOfThemIsForbidden() {
        // given
        List<MappedEndpoint> endpoints = endpointsMatching(AdminSurfaceTest::isPrivileged);
        TreeSet<String> discovered = endpoints.stream()
                .map(endpoint -> endpoint.method().name() + " " + endpoint.pattern())
                .collect(Collectors.toCollection(TreeSet::new));
        assertThat(discovered)
                .as("admin endpoint discovery must find exactly the privileged operations %s declares;"
                        + " a difference means discovery broke or an endpoint is served without being in"
                        + " the contract", API_DOCUMENT)
                .isNotEmpty()
                .isEqualTo(contractPrivilegedOperations());

        // when
        List<String> misrouted = new ArrayList<>();
        List<String> notForbidden = new ArrayList<>();
        for (MappedEndpoint endpoint : endpoints) {
            String where = endpoint.method() + " " + endpoint.concretePath();
            if (!routesWithTheIntendedVariables(endpoint)) {
                misrouted.add(where);
                continue;
            }
            String failure = forbiddenAsMemberFailure(endpoint);
            if (failure != null) {
                notForbidden.add(where + " — " + failure);
            }
        }

        // then
        assertMisroutedIsEmpty(misrouted);
        assertThat(notForbidden)
                .as("every one of the endpoints above must refuse a member")
                .isEmpty();
    }

    @Test
    void givenAnAnonymousCaller_whenCallingEveryAnonymousAllowedEndpoint_thenEveryOneOfThemPassesAuthorization() {
        // given
        List<MappedEndpoint> endpoints = endpointsMatchingAccess(AdminSurfaceTest::isAnonymousAllowed);
        assertThat(endpoints).isNotEmpty();

        // when
        List<String> misrouted = new ArrayList<>();
        List<String> notSuccessful = new ArrayList<>();
        for (MappedEndpoint endpoint : endpoints) {
            String where = endpoint.method() + " " + endpoint.concretePath();
            if (!routesWithTheIntendedVariables(endpoint)) {
                misrouted.add(where);
                continue;
            }
            String failure = successfulAsAnonymousFailure(endpoint);
            if (failure != null) {
                notSuccessful.add(where + " — " + failure);
            }
        }

        // then
        assertMisroutedIsEmpty(misrouted);
        assertThat(notSuccessful)
                .as("every one of the endpoints above must be reachable by an anonymous caller")
                .isEmpty();
    }

    @Test
    void givenAnAnonymousCaller_whenCallingEveryAuthenticatedEndpoint_thenEveryOneOfThemIsUnauthorized() {
        // given
        List<MappedEndpoint> endpoints = endpointsMatchingAccess(AdminSurfaceTest::isAuthenticatedOnly);
        assertThat(endpoints).isNotEmpty();

        // when
        List<String> misrouted = new ArrayList<>();
        List<String> notUnauthorized = new ArrayList<>();
        for (MappedEndpoint endpoint : endpoints) {
            String where = endpoint.method() + " " + endpoint.concretePath();
            if (!routesWithTheIntendedVariables(endpoint)) {
                misrouted.add(where);
                continue;
            }
            String failure = unauthorizedAsAnonymousFailure(endpoint);
            if (failure != null) {
                notUnauthorized.add(where + " — " + failure);
            }
        }

        // then
        assertMisroutedIsEmpty(misrouted);
        assertThat(notUnauthorized)
                .as("every one of the endpoints above must refuse an anonymous caller")
                .isEmpty();
    }

    @Test
    void givenAnAuthenticatedMember_whenCallingEveryAuthenticatedEndpoint_thenNoneOfThemIsUnauthorized() {
        // given
        List<MappedEndpoint> endpoints = endpointsMatchingAccess(AdminSurfaceTest::isAuthenticatedOnly);
        assertThat(endpoints).isNotEmpty();

        // when
        List<String> misrouted = new ArrayList<>();
        List<String> stillUnauthorized = new ArrayList<>();
        for (MappedEndpoint endpoint : endpoints) {
            String where = endpoint.method() + " " + endpoint.concretePath();
            if (!routesWithTheIntendedVariables(endpoint)) {
                misrouted.add(where);
                continue;
            }
            String failure = reachableAsAuthenticatedMemberFailure(endpoint);
            if (failure != null) {
                stillUnauthorized.add(where + " — " + failure);
            }
        }

        // then
        assertMisroutedIsEmpty(misrouted);
        assertThat(stillUnauthorized)
                .as("every one of the endpoints above must be reachable by an authenticated "
                        + "caller — whatever status the business logic beyond it answers with, "
                        + "authentication itself must not be what stops the request")
                .isEmpty();
    }

    @Test
    void givenEveryInitialPasswordRole_whenCallingEveryMappedEndpoint_thenOnlyPublicAndReplacementOperationsPassAuthorization() {
        // given
        List<MappedEndpoint> endpoints = endpointsMatching(pattern -> !pattern.equals(BOOT_ERROR_PATH));

        // when
        List<String> misrouted = new ArrayList<>();
        List<String> wrongDecisions = new ArrayList<>();
        for (Role role : Role.values()) {
            for (MappedEndpoint endpoint : endpoints) {
                String where = role + " " + endpoint.method() + " " + endpoint.concretePath();
                if (!routesWithTheIntendedVariables(endpoint)) {
                    misrouted.add(where);
                    continue;
                }
                String failure = initialPasswordDecisionFailure(role, endpoint);
                if (failure != null) {
                    wrongDecisions.add(where + " — " + failure);
                }
            }
        }

        // then
        assertMisroutedIsEmpty(misrouted);
        assertThat(wrongDecisions)
                .as("an issued credential may reach public operations and its one replacement "
                        + "operation, but no ordinary authenticated or administrative operation")
                .isEmpty();
    }

    private void assertMisroutedIsEmpty(List<String> misrouted) {
        assertThat(misrouted)
                .as("every concrete path built from a discovered pattern must resolve to a real "
                        + "mapping with each path variable holding the value substituted for it "
                        + "— otherwise a check below is proving nothing")
                .isEmpty();
    }

    @SuppressWarnings("unchecked")
    private boolean routesWithTheIntendedVariables(MappedEndpoint endpoint) {
        try {
            MockHttpServletRequest servletRequest =
                    new MockHttpServletRequest(endpoint.method().name(), endpoint.concretePath());
            // The mappings state what they consume, so a probe with no content type matches nothing.
            servletRequest.setContentType(endpoint.consumes().toString());
            servletRequest.addHeader(HttpHeaders.ACCEPT, MediaType.ALL_VALUE);
            ServletRequestPathUtils.parseAndCache(servletRequest);
            if (handlerMapping.getHandler(servletRequest) == null) {
                return false;
            }

            Map<String, String> extractedVariables = (Map<String, String>) servletRequest
                    .getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
            if (extractedVariables == null) {
                return true;
            }
            return extractedVariables.entrySet().stream().allMatch(variable -> variable.getValue()
                    .equals(EXPECTED_LITERAL_BY_VARIABLE.getOrDefault(variable.getKey(), CATCH_ALL_UUID)));
        } catch (Exception e) {
            return false;
        }
    }

    private String forbiddenAsMemberFailure(MappedEndpoint endpoint) {
        try {
            mockMvc.perform(request(endpoint.method(), endpoint.concretePath())
                            .contentType(endpoint.consumes())
                            .content(endpoint.probeBody())
                            .with(user(member))
                            .with(csrf()))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
            return null;
        } catch (Exception | AssertionError failure) {
            return failure.getMessage();
        }
    }

    private String unauthorizedAsAnonymousFailure(MappedEndpoint endpoint) {
        try {
            mockMvc.perform(request(endpoint.method(), endpoint.concretePath())
                            .contentType(endpoint.consumes())
                            .content(endpoint.probeBody())
                            .with(anonymous())
                            .with(csrf()))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
            return null;
        } catch (Exception | AssertionError failure) {
            return failure.getMessage();
        }
    }

    // One endpoint serves the API document as YAML.
    private String successfulAsAnonymousFailure(MappedEndpoint endpoint) {
        try {
            MockHttpServletRequestBuilder request = request(endpoint.method(), endpoint.concretePath())
                    .contentType(endpoint.consumes())
                    .content(endpoint.probeBody())
                    .with(anonymous())
                    .with(csrf());
            if (endpoint.method() == HttpMethod.GET && (endpoint.pattern().equals("/api/bookings")
                    || endpoint.pattern().equals("/api/reserved-slots"))) {
                request.param("date", "2026-05-12");
            }
            if (endpoint.pattern().equals("/api/public/config/icon")) {
                request.param("size", "192");
            }
            if (endpoint.pattern().equals("/api/account-recovery/password/redemption")
                    || endpoint.pattern().equals("/api/account-recovery/mfa/redemption")) {
                mockMvc.perform(request)
                        .andExpect(status().isBadRequest())
                        .andExpect(jsonPath("$.type")
                                .value("urn:courtside:error:account-recovery-code-invalid"));
            } else if (MFA_PROOF_REQUIRED_ENDPOINTS.contains(endpoint.key())) {
                mockMvc.perform(request)
                        .andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
            } else if (endpoint.pattern().equals("/api/public/config/logo")) {
                mockMvc.perform(request)
                        .andExpect(status().isNotFound())
                        .andExpect(jsonPath("$.type").value("urn:courtside:error:club-logo-not-found"));
            } else if (endpoint.answersWithoutABody()) {
                mockMvc.perform(request)
                        .andExpect(status().is2xxSuccessful())
                        .andExpect(content().string(""));
            } else {
                mockMvc.perform(request)
                        .andExpect(status().is2xxSuccessful())
                        .andExpect(content().contentTypeCompatibleWith(endpoint.produces()));
            }
            return null;
        } catch (Exception | AssertionError failure) {
            return failure.getMessage();
        }
    }

    private String reachableAsAuthenticatedMemberFailure(MappedEndpoint endpoint) {
        try {
            var result = mockMvc.perform(request(endpoint.method(), endpoint.concretePath())
                            .contentType(endpoint.consumes())
                            .content(endpoint.probeBody())
                            .with(user(member))
                            .with(csrf()));
            MockHttpServletResponse response = result.andReturn().getResponse();
            if (RECENT_AUTHENTICATION_ENDPOINTS.contains(endpoint.key())) {
                result.andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"));
                return null;
            }
            if (MFA_PROOF_REQUIRED_ENDPOINTS.contains(endpoint.key())) {
                result.andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
                return null;
            }
            int status = response.getStatus();
            if (status == HttpStatus.UNAUTHORIZED.value()) {
                return "still answered 401 Unauthorized";
            }
            if (status == HttpStatus.FORBIDDEN.value()) {
                return "answered 403 Forbidden — gated beyond plain authentication";
            }
            return null;
        } catch (Exception | AssertionError failure) {
            return failure.getMessage();
        }
    }

    private String initialPasswordDecisionFailure(Role role, MappedEndpoint endpoint) {
        try {
            var result = mockMvc.perform(
                            request(endpoint.method(), endpoint.concretePath())
                                    .contentType(endpoint.consumes())
                                    .content(endpoint.probeBody())
                                    .with(user("initial").authorities(
                                            new SimpleGrantedAuthority("ROLE_" + role.name()),
                                            new SimpleGrantedAuthority("PASSWORD_CHANGE_REQUIRED")))
                                    .with(csrf()));
            MockHttpServletResponse response = result.andReturn().getResponse();
            boolean admitted = isAnonymousAllowed(endpoint)
                    || endpoint.pattern().equals(INITIAL_PASSWORD_PATH);
            if (isAnonymousAllowed(endpoint) && MFA_PROOF_REQUIRED_ENDPOINTS.contains(endpoint.key())) {
                result.andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.type").value("urn:courtside:error:mfa-proof-failed"));
                return null;
            }
            if (admitted && (response.getStatus() == HttpStatus.UNAUTHORIZED.value()
                    || response.getStatus() == HttpStatus.FORBIDDEN.value())) {
                return "the authorization gate refused an admitted operation with "
                        + response.getStatus();
            }
            if (!admitted && response.getStatus() != HttpStatus.FORBIDDEN.value()) {
                return "an operation outside the initial-password boundary answered "
                        + response.getStatus();
            }
            if (!admitted) {
                result.andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
            }
            return null;
        } catch (Exception | AssertionError failure) {
            return failure.getMessage();
        }
    }

    private List<String> mappedPatterns() {
        return handlerMapping.getHandlerMethods().keySet().stream()
                .map(RequestMappingInfo::getPathPatternsCondition)
                .filter(Objects::nonNull)
                .flatMap(condition -> condition.getPatternValues().stream())
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static TreeSet<String> contractPrivilegedOperations() {
        Map<String, Object> document;
        try (InputStream in = AdminSurfaceTest.class.getResourceAsStream(API_DOCUMENT)) {
            assertThat(in).as("the API document must be on the classpath at %s", API_DOCUMENT).isNotNull();
            document = new Yaml().load(in);
        } catch (IOException closingFailed) {
            throw new UncheckedIOException(closingFailed);
        }
        TreeSet<String> operations = new TreeSet<>();
        ((Map<String, Map<String, Object>>) document.get("paths")).forEach((path, item) -> {
            if (isPrivileged(path)) {
                item.keySet().stream().filter(HTTP_METHODS::contains)
                        .forEach(method -> operations.add(method.toUpperCase() + " " + path));
            }
        });
        return operations;
    }

    private static boolean isPrivileged(String pattern) {
        return pattern.startsWith("/api/admin/") || pattern.equals(INITIAL_PASSWORD_PATH);
    }

    private List<MappedEndpoint> endpointsMatching(Predicate<String> patternFilter) {
        return handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream()
                        .filter(patternFilter)
                        .flatMap(pattern -> methodsOf(info).stream()
                                .map(method -> new MappedEndpoint(method, pattern, producesOf(info),
                                        consumesOf(info)))))
                .toList();
    }

    private List<MappedEndpoint> endpointsMatchingAccess(Predicate<MappedEndpoint> accessFilter) {
        return endpointsMatching(pattern -> true).stream().filter(accessFilter).toList();
    }

    private static boolean isAnonymousAllowed(MappedEndpoint endpoint) {
        return ANONYMOUS_ALLOWED_PATHS.contains(endpoint.pattern())
                || endpoint.method() == HttpMethod.GET && endpoint.pattern().equals("/api/bookings");
    }

    private static boolean isAuthenticatedOnly(MappedEndpoint endpoint) {
        return AUTHENTICATED_PATHS.contains(endpoint.pattern()) && !isAnonymousAllowed(endpoint);
    }

    private static MediaType consumesOf(RequestMappingInfo info) {
        return info.getConsumesCondition().getConsumableMediaTypes().stream()
                .findFirst()
                .orElse(MediaType.APPLICATION_JSON);
    }

    private static MediaType producesOf(RequestMappingInfo info) {
        return info.getProducesCondition().getProducibleMediaTypes().stream()
                .findFirst()
                .orElse(MediaType.APPLICATION_JSON);
    }

    private static List<HttpMethod> methodsOf(RequestMappingInfo info) {
        var methods = info.getMethodsCondition().getMethods();
        if (methods.isEmpty()) {
            return List.of(HttpMethod.GET);
        }
        return methods.stream()
                .map(RequestMethod::name)
                .map(HttpMethod::valueOf)
                .toList();
    }

    private record MappedEndpoint(HttpMethod method, String pattern, MediaType produces,
                                  MediaType consumes) {

        String probeBody() {
            if (pattern.equals("/api/account-recovery/password")) {
                return "{\"username\":\"nobody.here\"}";
            }
            if (pattern.equals("/api/account-recovery/password/redemption")) {
                return "{\"code\":\"ABCD-EFGH\",\"password\":\"nobody-holds-this-code\"}";
            }
            if (pattern.equals("/api/account-recovery/mfa/redemption")) {
                return "{\"username\":\"nobody.here\",\"code\":\"ABCD-EFGH\",\"password\":\"nobody-holds-this-code\"}";
            }
            if (pattern.equals("/api/account-recovery/usernames")) {
                return "{\"email\":\"nobody@example.org\"}";
            }
            if (pattern.equals("/api/session/mfa") || pattern.equals("/api/account/mfa/totp/confirmation")) {
                return "{\"code\":\"000000\"}";
            }
            if (pattern.equals("/api/session/mfa/webauthn")) {
                return """
                        {"id":"AA","rawId":"AA","type":"public-key","response":{
                        "clientDataJSON":"e30","authenticatorData":"AA","signature":"AA"}}
                        """;
            }
            if (pattern.equals("/api/account/mfa/webauthn")) {
                return """
                        {"label":"Example key","credential":{"id":"AA","rawId":"AA","type":"public-key",
                        "response":{"clientDataJSON":"e30","attestationObject":"AA"}}}
                        """;
            }
            if (pattern.equals("/api/account/mfa/webauthn/credentials/{credentialId}") && method == HttpMethod.PATCH) {
                return "{\"label\":\"Example key\"}";
            }
            return MediaType.APPLICATION_JSON.includes(consumes) ? "{}" : "";
        }

        String key() {
            return method + " " + pattern;
        }

        // Nothing answers a problem document on the way out, so declaring it as the only content
        // is how the contract says this operation succeeds without a body.
        boolean answersWithoutABody() {
            return MediaType.APPLICATION_PROBLEM_JSON.equals(produces);
        }

        String concretePath() {
            return pattern
                    .replaceAll("\\{day}", "MONDAY")
                    .replaceAll("\\{ruleType}", "ADVANCE_WINDOW")
                    .replaceAll("\\{[^}]+}", CATCH_ALL_UUID);
        }
    }
}
