package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.util.ServletRequestPathUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The tests below classify every mapped path into exactly one of three buckets and prove the
// classification holds against the running security filter chain, in both directions per bucket:
// an anonymous-allowed path must succeed anonymously, an authenticated path must refuse an
// anonymous caller and succeed for an authenticated one, and an admin path must refuse a member.
class AdminSurfaceTest extends AbstractIntegrationTest {

    private static final int KNOWN_ADMIN_ENDPOINT_COUNT = 36;

    private static final String CATCH_ALL_UUID = "11111111-1111-1111-1111-111111111111";

    private static final String BOOT_ERROR_PATH = "/error";

    // A variable missing here is checked against the catch-all UUID it was given, which proves nothing.
    private static final Map<String, String> EXPECTED_LITERAL_BY_VARIABLE = Map.of(
            "day", "MONDAY",
            "ruleType", "ADVANCE_WINDOW");

    private static final Set<String> ANONYMOUS_ALLOWED_PATHS = Set.of(
            "/api/openapi.yaml",
            "/api/public/config",
            "/api/public/courts",
            "/api/public/opening-hours");

    private static final Set<String> AUTHENTICATED_PATHS = Set.of(
            "/api/public/booking-cards",
            "/api/public/participant-cards",
            "/api/bookings",
            "/api/bookings/{id}",
            "/api/booking-series",
            "/api/booking-series/preview",
            "/api/booking-series/{id}",
            "/api/booking-series/{id}/move",
            "/api/booking-series/{id}/move/preview");

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

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        Person person = persons.save(new Person("Jane", "Doe", "doe.jane@example.org"));
        UserAccount account = new UserAccount(
                person, "doe.jane", passwordEncoder.encode("secret"), Set.of(Role.MEMBER));
        account.enable();
        accounts.save(account);
    }

    @Test
    void whenEveryMappedPathIsInspected_thenItIsClassifiedAsAdminAnonymousOrAuthenticated() {
        // given — the two permissive buckets must be disjoint, or a path's classification is ambiguous
        assertThat(ANONYMOUS_ALLOWED_PATHS)
                .as("a path cannot be both anonymous-allowed and authenticated-only")
                .doesNotContainAnyElementsOf(AUTHENTICATED_PATHS);

        List<String> mapped = mappedPatterns();

        // when
        List<String> unclassified = mapped.stream()
                .filter(pattern -> !pattern.equals(BOOT_ERROR_PATH))
                .filter(pattern -> !pattern.startsWith("/api/admin/"))
                .filter(pattern -> !ANONYMOUS_ALLOWED_PATHS.contains(pattern))
                .filter(pattern -> !AUTHENTICATED_PATHS.contains(pattern))
                .toList();

        // then — a path here is either an admin endpoint reachable outside /api/admin/, or a new
        // endpoint nobody classified into one of the three buckets; either way its actual
        // reachability is unproven
        assertThat(unclassified).isEmpty();
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAMember_whenCallingEveryAdminEndpoint_thenEveryOneOfThemIsForbidden() {
        // given
        List<MappedEndpoint> endpoints = endpointsMatching(pattern -> pattern.startsWith("/api/admin/"));
        assertThat(endpoints)
                .as("admin endpoint discovery is expected to match the known count of %d exactly; "
                        + "a mismatch means discovery broke, an endpoint was added, or an endpoint "
                        + "was removed — in every case this constant must be updated to match once "
                        + "the cause is confirmed", KNOWN_ADMIN_ENDPOINT_COUNT)
                .hasSize(KNOWN_ADMIN_ENDPOINT_COUNT);

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
    void givenAnAnonymousCaller_whenCallingEveryAnonymousAllowedEndpoint_thenEveryOneOfThemSucceeds() {
        // given
        List<MappedEndpoint> endpoints = endpointsMatching(ANONYMOUS_ALLOWED_PATHS::contains);
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
        List<MappedEndpoint> endpoints = endpointsMatching(AUTHENTICATED_PATHS::contains);
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
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnAuthenticatedMember_whenCallingEveryAuthenticatedEndpoint_thenNoneOfThemIsUnauthorized() {
        // given
        List<MappedEndpoint> endpoints = endpointsMatching(AUTHENTICATED_PATHS::contains);
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
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}")
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
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}")
                            .with(anonymous())
                            .with(csrf()))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
            return null;
        } catch (Exception | AssertionError failure) {
            return failure.getMessage();
        }
    }

    // The content type is taken from what the mapping declares rather than assumed to be JSON:
    // one endpoint serves the API document as YAML on purpose, and hard-coding JSON here would
    // have made that a test failure instead of a described fact.
    private String successfulAsAnonymousFailure(MappedEndpoint endpoint) {
        try {
            mockMvc.perform(request(endpoint.method(), endpoint.concretePath())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}")
                            .with(anonymous())
                            .with(csrf()))
                    .andExpect(status().is2xxSuccessful())
                    .andExpect(content().contentTypeCompatibleWith(endpoint.produces()));
            return null;
        } catch (Exception | AssertionError failure) {
            return failure.getMessage();
        }
    }

    // Unlike the two checks above, this deliberately does not pin a single expected status: the
    // endpoints in AUTHENTICATED_PATHS are heterogeneous (some need a body, a query parameter or a
    // real id to succeed), so the only thing every one of them shares is that neither the
    // authentication gate nor a role restriction may be why they fail. 401 and 403 are produced
    // exclusively by ProblemDetailAuthenticationEntryPoint and ProblemDetailAccessDeniedHandler in
    // this app, so their absence unambiguously proves the request passed both gates.
    private String reachableAsAuthenticatedMemberFailure(MappedEndpoint endpoint) {
        try {
            int status = mockMvc.perform(request(endpoint.method(), endpoint.concretePath())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}")
                            .with(csrf()))
                    .andReturn().getResponse().getStatus();
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

    private List<String> mappedPatterns() {
        return handlerMapping.getHandlerMethods().keySet().stream()
                .map(RequestMappingInfo::getPathPatternsCondition)
                .filter(Objects::nonNull)
                .flatMap(condition -> condition.getPatternValues().stream())
                .toList();
    }

    private List<MappedEndpoint> endpointsMatching(Predicate<String> patternFilter) {
        return handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream()
                        .filter(patternFilter)
                        .flatMap(pattern -> methodsOf(info).stream()
                                .map(method -> new MappedEndpoint(method, pattern, producesOf(info)))))
                .toList();
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

    private record MappedEndpoint(HttpMethod method, String pattern, MediaType produces) {

        String concretePath() {
            return pattern
                    .replaceAll("\\{day}", "MONDAY")
                    .replaceAll("\\{ruleType}", "ADVANCE_WINDOW")
                    .replaceAll("\\{[^}]+}", CATCH_ALL_UUID);
        }
    }
}
