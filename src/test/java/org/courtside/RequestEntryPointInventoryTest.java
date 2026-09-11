package org.courtside;

import jakarta.servlet.Filter;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.MethodParameter;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class RequestEntryPointInventoryTest extends AbstractIntegrationTest {

    private record Boundary(String classification, List<String> reads) {
    }

    private static final Path SOURCE_ROOT = Path.of("src/main/java");

    private static final Pattern CARRIES_THE_REQUEST = Pattern.compile(
            "\\b(HttpServletRequest|ServletRequest|NativeWebRequest|WebRequest|RequestContextHolder)\\b");

    private static final Pattern READ = Pattern.compile("\\.((?:get|is)[A-Za-z]+)\\(\\s*(?:\"([^\"]*)\")?");

    private static final Set<String> SERVLET_READS =
            Stream.of(HttpServletRequest.class.getMethods(), ServletRequest.class.getMethods())
                    .flatMap(Arrays::stream)
                    .map(Method::getName)
                    .filter(name -> name.startsWith("get") || name.startsWith("is"))
                    .collect(java.util.stream.Collectors.toUnmodifiableSet());

    private static final Map<String, Boundary> REVIEWED_REQUEST_READS = Map.ofEntries(
            Map.entry("org/courtside/identity/RecentAuthentication.java",
                    new Boundary("the session the request already carries, and the marks this"
                            + " application itself wrote into it", List.of("getAttribute",
                            "getAttributeNames", "getSession"))),
            Map.entry("org/courtside/identity/internal/AbsoluteSessionLifetimeFilter.java",
                    new Boundary("the session the request already carries", List.of("getSession"))),
            Map.entry("org/courtside/identity/internal/AccountController.java",
                    new Boundary("the session the request already carries, and the Accept-Language"
                            + " header, which chooses a language and never a right",
                            List.of("getLocale", "getSession"))),
            Map.entry("org/courtside/identity/internal/AccountSessionService.java",
                    new Boundary("the session the request already carries, and the marks this"
                            + " application itself wrote into it", List.of("getAttribute", "getSession"))),
            Map.entry("org/courtside/identity/internal/InvalidSessionCookieFilter.java",
                    new Boundary("the session the request already carries, beside the session cookie"
                            + " the document declares as a security scheme", List.of("getSession"))),
            Map.entry("org/courtside/identity/internal/LoginAttemptFilter.java",
                    new Boundary("the peer address the rate limit counts, which the reverse proxy"
                            + " described by deploy/README.md is required to supply",
                            List.of("getRemoteAddr"))),
            Map.entry("org/courtside/identity/internal/ProblemDetailAccessDeniedHandler.java",
                    new Boundary("nothing of the request itself", List.of())),
            Map.entry("org/courtside/identity/internal/ProblemDetailAuthenticationEntryPoint.java",
                    new Boundary("the requested address, echoed into the problem instance and"
                            + " nowhere else", List.of("getRequestURI"))),
            Map.entry("org/courtside/identity/internal/SecurityConfiguration.java",
                    new Boundary("the User-Agent header, classified into a browser family a session"
                            + " carries, and the scheme, which decides which cookie names apply",
                            List.of("getHeader(\"User-Agent\")", "getScheme", "getSession", "isSecure"))),
            Map.entry("org/courtside/identity/internal/SecurityEpochFilter.java",
                    new Boundary("the session the request already carries", List.of("getSession"))),
            Map.entry("org/courtside/identity/internal/SecurityRequestObservationFilter.java",
                    new Boundary("the host and scheme the application saw, reflected into response"
                            + " headers the assessment reads and no production image carries",
                            List.of("getScheme", "getServerName"))),
            Map.entry("org/courtside/member/web/RosterAdminController.java",
                    new Boundary("the session the request already carries, and the Accept-Language"
                            + " header, which chooses a language and never a right",
                            List.of("getLocale", "getSession"))),
            Map.entry("org/courtside/shared/web/ContainerErrorController.java",
                    new Boundary("the attributes the servlet container sets on an error dispatch,"
                            + " which no client can write", List.of("getAttribute"))));

    private static final Map<String, String> REVIEWED_FILTERS = Map.ofEntries(
            Map.entry("DisableEncodeUrlFilter", "refuses a session id in a URL"),
            Map.entry("WebAsyncManagerIntegrationFilter", "carries the security context into async work"),
            Map.entry("SecurityContextHolderFilter", "reads the stored security context"),
            Map.entry("SecurityEpochFilter", "reads the session and ends it when the account changed"),
            Map.entry("SecurityRequestObservationFilter",
                    "reflects the host and scheme the application saw, and is present only where"
                            + " courtside.environment is SECURITY"),
            Map.entry("AbsoluteSessionLifetimeFilter", "reads the session and ends it when it is too old"),
            Map.entry("InvalidSessionCookieFilter", "answers a session cookie that names no session"),
            Map.entry("HeaderWriterFilter", "writes response headers and reads no request value"),
            Map.entry("CsrfFilter", "reads the X-XSRF-TOKEN header the document declares"),
            Map.entry("LogoutFilter", "matches the logout address"),
            Map.entry("LoginAttemptFilter", "reads the peer address and counts attempts against it"),
            Map.entry("UsernamePasswordAuthenticationFilter",
                    "reads the username and password form fields POST /api/session declares"),
            Map.entry("ConcurrentSessionFilter", "reads the session registry"),
            Map.entry("RequestCacheAwareFilter", "replays a request the cache saved"),
            Map.entry("SecurityContextHolderAwareRequestFilter", "wraps the request in the servlet API"),
            Map.entry("AnonymousAuthenticationFilter", "supplies an authentication where none was read"),
            Map.entry("SessionManagementFilter", "applies the session policy"),
            Map.entry("ExceptionTranslationFilter", "turns a refusal into the problem answer"),
            Map.entry("AuthorizationFilter", "decides the request against the authorization rules"),
            Map.entry("characterEncodingFilter", "fixes the encoding a request body is read with"),
            Map.entry("formContentFilter", "reads a form body on a method the servlet API would not"),
            Map.entry("requestContextFilter", "publishes the request to the thread"),
            Map.entry("springSecurityFilterChain", "delegates into the security chain above"),
            Map.entry("springSessionRepositoryFilter", "resolves the session cookie to a stored session"));

    private static final Set<String> SUPPORTED_ENCODINGS = Set.of(
            "application/json", "application/x-www-form-urlencoded", "multipart/form-data");

    private static final Map<String, Object> DOCUMENT = document();

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private RequestMappingHandlerMapping mappings;

    @Autowired
    private FilterChainProxy securityFilters;

    @Autowired
    private Map<String, Filter> filterBeans;

    @Test
    void whenTheApplicationBindsARequestInput_thenTheDocumentDeclaresTheSameOne() {
        // when
        TreeSet<String> bound = boundInputs();
        TreeSet<String> declared = declaredInputs();

        // then
        assertThat(bound).as("a request input exists to be compared").isNotEmpty();
        assertThat(bound)
                .as("an input the application binds but %s does not declare is a request surface"
                        + " nobody reviewed, including one on an address the document does not"
                        + " describe at all, and one the document declares but nothing binds is a"
                        + " promise the application does not keep.",
                        "src/main/resources/api/openapi.yaml")
                .containsExactlyInAnyOrderElementsOf(declared);
    }

    @Test
    void whenTheLoginFormIsRead_thenItsFieldsAreTheOnesTheDocumentDeclares() {
        // given
        UsernamePasswordAuthenticationFilter login = securityFilters.getFilterChains().stream()
                .flatMap(chain -> chain.getFilters().stream())
                .filter(UsernamePasswordAuthenticationFilter.class::isInstance)
                .map(UsernamePasswordAuthenticationFilter.class::cast)
                .findFirst()
                .orElseThrow(() -> new AssertionError("no form login filter serves this application"));

        // when
        Set<String> read = Set.of(login.getUsernameParameter(), login.getPasswordParameter());

        // then
        assertThat(read)
                .as("the login is served by a filter rather than by a handler, so nothing else"
                        + " compares the fields it reads with the form the document declares.")
                .containsExactlyInAnyOrderElementsOf(formProperties("/api/session", "post"));
    }

    @Test
    void whenEveryFilterThatCanSeeARequestIsRead_thenTheInventoryClassifiesIt() throws Exception {
        // when
        TreeSet<String> present = new TreeSet<>(filterBeans.keySet());
        securityFilters.getFilterChains().stream()
                .flatMap(chain -> chain.getFilters().stream())
                .map(filter -> filter.getClass().getSimpleName())
                .forEach(present::add);
        declaredFilterClasses().forEach(present::add);

        // then
        assertThat(present).as("a filter exists to be classified").isNotEmpty();
        assertThat(present)
                .as("a filter runs before every rule this application states, so one that is not"
                        + " classified is a request entry point nobody reviewed.")
                .containsExactlyInAnyOrderElementsOf(REVIEWED_FILTERS.keySet());
        assertThat(REVIEWED_FILTERS.values()).allSatisfy(classification ->
                assertThat(classification).isNotBlank());
    }

    @Test
    void whenTheProductionSourcesReadARequestDirectly_thenTheInventoryNamesEveryValue() throws Exception {
        // when
        Map<String, List<String>> read = requestReads();

        // then
        assertThat(read).as("a direct request read exists to be inventoried").isNotEmpty();
        assertThat(read)
                .as("a value read straight off the request is outside the contract the document"
                        + " states, so an unlisted one is an input nobody classified.")
                .containsExactlyInAnyOrderEntriesOf(new TreeMap<>(REVIEWED_REQUEST_READS.entrySet()
                        .stream()
                        .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey,
                                entry -> entry.getValue().reads()))));
        assertThat(REVIEWED_REQUEST_READS.values()).allSatisfy(boundary ->
                assertThat(boundary.classification()).isNotBlank());
    }

    @Test
    void whenTheSupportedRequestEncodingsAreRead_thenTheyAreTheReviewedOnes() {
        // when
        TreeSet<String> supported = new TreeSet<>(documentedEncodings());
        mappings.getHandlerMethods().keySet().stream()
                .flatMap(info -> info.getConsumesCondition().getExpressions().stream())
                .map(expression -> expression.getMediaType().toString())
                .forEach(supported::add);

        // then
        assertThat(supported)
                .as("an encoding decides which parser reads a request body, so a new one is a new"
                        + " parser on the request path rather than a detail of one operation.")
                .containsExactlyInAnyOrderElementsOf(SUPPORTED_ENCODINGS);
    }

    private TreeSet<String> boundInputs() {
        TreeSet<String> bound = new TreeSet<>();
        mappings.getHandlerMethods().forEach((info, handler) ->
                paths(info).forEach(path -> methods(info).forEach(method -> {
                    boolean form = !formProperties(path, method).isEmpty();
                    for (MethodParameter parameter : handler.getMethodParameters()) {
                        input(parameter, form).ifPresent(
                                value -> bound.add(method.toUpperCase() + " " + path + " " + value));
                    }
                })));
        return bound;
    }

    private TreeSet<String> declaredInputs() {
        TreeSet<String> declared = new TreeSet<>();
        Set<String> served = new TreeSet<>();
        mappings.getHandlerMethods().keySet().forEach(info ->
                paths(info).forEach(path -> methods(info)
                        .forEach(method -> served.add(method + " " + path))));
        paths().forEach((path, item) -> operations(item).forEach((method, operation) -> {
            if (!served.contains(method + " " + path)) {
                return;
            }
            String prefix = method.toUpperCase() + " " + path + " ";
            parameters(item, operation).forEach(parameter ->
                    declared.add(prefix + parameter.get("in") + ":" + parameter.get("name")));
            Set<String> form = formProperties(path, method);
            if (!form.isEmpty()) {
                form.forEach(property -> declared.add(prefix + "body:" + property));
            } else if (operation.containsKey("requestBody")) {
                declared.add(prefix + "body");
            }
        }));
        return declared;
    }

    private static java.util.Optional<String> input(MethodParameter parameter, boolean form) {
        for (Annotation annotation : parameter.getParameterAnnotations()) {
            if (annotation instanceof PathVariable variable) {
                return java.util.Optional.of("path:" + name(variable.name(), variable.value(), parameter));
            }
            if (annotation instanceof RequestParam query) {
                String name = name(query.name(), query.value(), parameter);
                return java.util.Optional.of((form ? "body:" : "query:") + name);
            }
            if (annotation instanceof RequestHeader header) {
                return java.util.Optional.of("header:" + name(header.name(), header.value(), parameter));
            }
            if (annotation instanceof CookieValue cookie) {
                return java.util.Optional.of("cookie:" + name(cookie.name(), cookie.value(), parameter));
            }
            if (annotation instanceof RequestPart part) {
                return java.util.Optional.of("body:" + name(part.name(), part.value(), parameter));
            }
            if (annotation instanceof RequestBody) {
                return java.util.Optional.of("body");
            }
        }
        return java.util.Optional.empty();
    }

    private static String name(String name, String value, MethodParameter parameter) {
        if (!name.isEmpty()) {
            return name;
        }
        if (!value.isEmpty()) {
            return value;
        }
        return String.valueOf(parameter.getParameterName());
    }

    private static List<String> paths(RequestMappingInfo info) {
        return info.getPathPatternsCondition() == null ? List.of()
                : info.getPathPatternsCondition().getPatterns().stream()
                        .map(pattern -> pattern.getPatternString()).toList();
    }

    // A mapping that restricts no method answers all of them, so it must not drop out of the
    // comparison for having named none.
    private static List<String> methods(RequestMappingInfo info) {
        List<String> named = info.getMethodsCondition().getMethods().stream()
                .map(method -> method.name().toLowerCase()).toList();
        return named.isEmpty() ? List.of("any") : named;
    }

    private Map<String, List<String>> requestReads() throws Exception {
        TreeMap<String, List<String>> read = new TreeMap<>();
        try (Stream<Path> sources = Files.walk(SOURCE_ROOT)) {
            for (Path source : sources.filter(path -> path.toString().endsWith(".java")).toList()) {
                String text = Files.readString(source);
                if (!CARRIES_THE_REQUEST.matcher(text).find()) {
                    continue;
                }
                TreeSet<String> values = new TreeSet<>();
                Matcher matcher = READ.matcher(text);
                while (matcher.find()) {
                    if (SERVLET_READS.contains(matcher.group(1))) {
                        values.add(matcher.group(1)
                                + (matcher.group(2) == null ? "" : "(\"" + matcher.group(2) + "\")"));
                    }
                }
                read.put(SOURCE_ROOT.relativize(source).toString().replace('\\', '/'),
                        List.copyOf(values));
            }
        }
        return read;
    }

    private static List<String> declaredFilterClasses() throws Exception {
        try (Stream<Path> sources = Files.walk(SOURCE_ROOT)) {
            return sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(RequestEntryPointInventoryTest::declaresAFilter)
                    .map(path -> path.getFileName().toString().replace(".java", ""))
                    .toList();
        }
    }

    private static boolean declaresAFilter(Path source) {
        try {
            String text = Files.readString(source);
            return text.contains("doFilterInternal(") || text.contains("public void doFilter(");
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> document() {
        try (InputStream stream = RequestEntryPointInventoryTest.class
                .getResourceAsStream("/api/openapi.yaml")) {
            return new Yaml().loadAs(stream, Map.class);
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Map<String, Object>> paths() {
        return (Map<String, Map<String, Object>>) DOCUMENT.get("paths");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Map<String, Object>> operations(Map<String, Object> item) {
        Map<String, Map<String, Object>> operations = new LinkedHashMap<>();
        item.forEach((key, value) -> {
            if (!key.startsWith("x-") && !key.equals("parameters") && value instanceof Map<?, ?>) {
                operations.put(key, (Map<String, Object>) value);
            }
        });
        return operations;
    }

    private static Map<String, Object> operation(String path, String method) {
        Map<String, Object> item = paths().get(path);
        return item == null ? null : operations(item).get(method);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> parameters(
            Map<String, Object> item, Map<String, Object> operation) {
        List<Map<String, Object>> parameters = new ArrayList<>();
        Stream.concat(((List<Object>) item.getOrDefault("parameters", List.of())).stream(),
                        ((List<Object>) operation.getOrDefault("parameters", List.of())).stream())
                .forEach(parameter -> parameters.add((Map<String, Object>) resolve(parameter)));
        return parameters;
    }

    @SuppressWarnings("unchecked")
    private static Set<String> formProperties(String path, String method) {
        Map<String, Object> operation = operation(path, method);
        if (operation == null) {
            return Set.of();
        }
        Map<String, Object> body = (Map<String, Object>) resolve(operation.get("requestBody"));
        if (body == null) {
            return Set.of();
        }
        Map<String, Object> content = (Map<String, Object>) body.get("content");
        return content.entrySet().stream()
                .filter(entry -> !entry.getKey().equals("application/json"))
                .map(entry -> (Map<String, Object>) resolve(
                        ((Map<String, Object>) entry.getValue()).get("schema")))
                .filter(schema -> schema.containsKey("properties"))
                .flatMap(schema -> ((Map<String, Object>) schema.get("properties")).keySet().stream())
                .collect(java.util.stream.Collectors.toCollection(TreeSet::new));
    }

    @SuppressWarnings("unchecked")
    private static Set<String> documentedEncodings() {
        TreeSet<String> encodings = new TreeSet<>();
        paths().forEach((path, item) -> operations(item).values().forEach(operation -> {
            Map<String, Object> body = (Map<String, Object>) resolve(operation.get("requestBody"));
            if (body != null) {
                encodings.addAll(((Map<String, Object>) body.get("content")).keySet());
            }
        }));
        return encodings;
    }

    @SuppressWarnings("unchecked")
    private static Object resolve(Object node) {
        Object current = node;
        for (int depth = 0; current instanceof Map<?, ?> map && map.get("$ref") instanceof String ref;
                depth++) {
            if (depth > 16) {
                throw new IllegalStateException("the document refers to itself at " + ref);
            }
            Object target = DOCUMENT;
            for (String segment : ref.substring(2).split("/")) {
                target = ((Map<String, Object>) target).get(segment);
            }
            current = target;
        }
        return current;
    }
}
