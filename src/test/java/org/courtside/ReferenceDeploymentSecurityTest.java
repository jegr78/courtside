package org.courtside;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

public class ReferenceDeploymentSecurityTest {

    private static final Pattern REVERSE_PROXY_BLOCK = Pattern.compile(
            "(?m)^\\treverse_proxy app:8080 \\{\\R(?<directives>(?:\\t\\t[^\\r\\n]*\\R)*)\\t}$");
    private static final Pattern UPSTREAM = Pattern.compile("(?m)^\\t*reverse_proxy [^\\r\\n]*\\{");
    private static final Pattern APPLICATION_HEADERS = Pattern.compile(
            "(?m)^\\(applicationHeaders\\) \\{\\R(?<directives>(?:\\t[^\\r\\n]*\\R)*)}$");
    private static final Pattern PRODUCTION_SITE_BLOCK = Pattern.compile(
            "(?m)^\\{\\$COURTSIDE_DOMAIN} \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern UAT_PUBLIC_SITE_BLOCK = Pattern.compile(
            "(?m)^https://localhost:443 \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern PRODUCTION_PLAINTEXT_SITE_BLOCK = Pattern.compile(
            "(?m)^http://:80 \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern UAT_PLAINTEXT_SITE_BLOCK = Pattern.compile(
            "(?m)^http://:80 \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern HEADER_BLOCK = Pattern.compile(
            "(?m)^\\theader \\{\\R(?<fields>(?:\\t\\t.*\\R)*)\\t}$");
    private static final List<String> FORWARDED_HEADERS = List.of("forwarded", "x-forwarded-for",
            "x-forwarded-host", "x-forwarded-port", "x-forwarded-prefix", "x-forwarded-proto",
            "x-forwarded-ssl");
    private static final Map<String, Boolean> APPLICATION_UPSTREAMS = Map.of(
            "app:8080", true, "https://app:8080", true, "host.docker.internal:8080", true,
            "api-ui:8080", false);
    private static final Pattern UPSTREAM_DESTINATION = Pattern.compile(
            "^reverse_proxy\\s+(?<destination>\\S+)");
    private static final Pattern SNIPPET_NAME = Pattern.compile("^\\((?<name>[A-Za-z_][A-Za-z0-9_]*)\\)");
    private static final Pattern SNIPPET_IMPORT = Pattern.compile(
            "\\s*import\\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\\s*");
    private static final Pattern HEADER_DELETION = Pattern.compile("\\s*header_up\\s+-(?<name>\\S+)\\s*");
    private static final Pattern HEADER_ASSIGNMENT = Pattern.compile(
            "\\s*header_up\\s+(?<name>[A-Za-z][^\\s+]*)\\s+\\S.*");
    private static final Pattern SERVICE_BLOCK = Pattern.compile(
            "(?ms)^  [a-zA-Z0-9_-]+:\\R(?<body>.*?)(?=^  [a-zA-Z0-9_-]+:\\R|\\z)");

    private static final String GHCR_RELEASE_IMAGE =
            "image: ghcr.io/jegr78/courtside:${COURTSIDE_VERSION:?set COURTSIDE_VERSION in .env}";
    private static final String UAT_LOCAL_IMAGE_ALIAS =
            "image: ${COURTSIDE_UAT_IMAGE:-courtside:uat-local}";
    private static final String PERF_LOCAL_IMAGE_ALIAS =
            "image: courtside:perf-local";
    private static final String UPGRADE_CANDIDATE_IMAGE_ALIAS =
            "image: ${COURTSIDE_UPGRADE_IMAGE}";
    private static final String RESTORE_CANDIDATE_IMAGE_ALIAS =
            "image: ${COURTSIDE_RESTORE_IMAGE}";
    private static final String SECURITY_CANDIDATE_IMAGE_ALIAS =
            "image: ${COURTSIDE_SECURITY_IMAGE:?required}";
    private static final Set<String> OWN_IMAGE_REFERENCES =
            Set.of(GHCR_RELEASE_IMAGE, UAT_LOCAL_IMAGE_ALIAS, PERF_LOCAL_IMAGE_ALIAS,
                    UPGRADE_CANDIDATE_IMAGE_ALIAS, RESTORE_CANDIDATE_IMAGE_ALIAS,
                    SECURITY_CANDIDATE_IMAGE_ALIAS);

    @Test
    void whenReadingImageSources_thenEveryThirdPartyImageIsPinnedByDigest() throws IOException {
        // given
        List<Path> sources;
        try (var deploymentFiles = Files.list(Path.of("deploy"))) {
            sources = deploymentFiles
                    .filter(path -> path.getFileName().toString().matches("compose(?:\\..+)?\\.yaml"))
                    .sorted()
                    .toList();
        }

        // when / then
        for (Path source : Stream.concat(Stream.of(Path.of("Dockerfile")), sources.stream()).toList()) {
            Files.readAllLines(source).stream()
                    .map(String::strip)
                    .filter(line -> line.startsWith("FROM ") || line.startsWith("image:"))
                    .filter(line -> !OWN_IMAGE_REFERENCES.contains(line))
                    .forEach(line -> assertThat(line)
                            .as("%s pins its image by digest", source)
                            .contains("@sha256:"));
        }
    }

    @Test
    void whenReadingProductionCompose_thenOwnImageIsSelectedByVersionNotDigest() throws IOException {
        // given
        List<String> ownImageLines = Files.readAllLines(Path.of("deploy/compose.yaml")).stream()
                .map(String::strip)
                .filter(OWN_IMAGE_REFERENCES::contains)
                .toList();

        // when / then
        assertThat(ownImageLines).containsExactly(GHCR_RELEASE_IMAGE);
    }

    @Test
    void whenReadingTheContainerEntrypoint_thenUnsupportedUnsafeAccessIsDenied() throws IOException {
        // when
        String dockerfile = Files.readString(Path.of("Dockerfile"));

        // then
        assertThat(dockerfile)
                .contains("--sun-misc-unsafe-memory-access=deny")
                .doesNotContain("--sun-misc-unsafe-memory-access=allow");
    }

    @Test
    void givenTheProductionImage_whenReadingItsCopyBoundary_thenSourceControlMetadataCannotEnterIt()
            throws IOException {
        // when
        List<String> copiedPaths = Files.readString(Path.of("Dockerfile")).lines()
                .map(String::strip)
                .filter(line -> line.startsWith("COPY "))
                .toList();

        // then
        assertThat(copiedPaths).containsExactly(
                "COPY ${LAYERS}/dependencies/ ./",
                "COPY ${LAYERS}/spring-boot-loader/ ./",
                "COPY ${LAYERS}/snapshot-dependencies/ ./",
                "COPY ${LAYERS}/application/ ./",
                "COPY LICENSE NOTICE ./");
    }

    @Test
    void givenTheProductionDeployment_whenReadingServiceCredentials_thenNoneHasALiteralDefault()
            throws IOException {
        // given
        Pattern credential = Pattern.compile(
                "^\\s+[A-Z0-9_]*(?:PASSWORD|PASS|PWD|TOKEN|AUTHORIZATION|SECRET|API_KEY|CREDENTIAL):"
                        + "\\s+(?<value>\\S.*)$");

        // when
        List<String> values = Files.readString(Path.of("deploy/compose.yaml")).lines()
                .map(credential::matcher)
                .filter(Matcher::matches)
                .map(matcher -> matcher.group("value"))
                .toList();

        // then
        assertThat(values).isNotEmpty().allSatisfy(value -> assertThat(value)
                .matches("^\\$\\{[A-Z0-9_]+(?::[-?][^}]*)?}$")
                .doesNotMatch(".*:-[^}]+}.*"));
    }

    @Test
    void givenTheProductionStartup_whenReadingItsCommands_thenNoDebugModeCanBeEnabled()
            throws IOException {
        // when
        String startup = Files.readString(Path.of("Dockerfile")) + "\n"
                + Files.readString(Path.of("deploy/compose.yaml")) + "\n"
                + Files.readString(Path.of("deploy/Caddyfile"));

        // then
        assertThat(startup)
                .doesNotContain("-agentlib:jdwp", "-agentpath:", "-Xdebug", "-Xrunjdwp", "--debug",
                        "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "SPRING_PROFILES_ACTIVE",
                        "spring.profiles.active");
        assertThat(startup.lines().map(String::strip).toList()).doesNotContain("debug");
        assertThat(startup).doesNotContainPattern("(?m)^\\s*(?:ENV\\s+)?(?:DEBUG|debug)[:=]");
    }

    @Test
    void whenReadingComposeFile_thenApplicationPortIsBoundToLoopback() throws IOException {
        // when
        String compose = Files.readString(Path.of("deploy/compose.yaml"));

        // then
        assertThat(compose).contains("127.0.0.1:${COURTSIDE_PORT:-8080}:8080");
    }

    // An instance without mail configuration refuses to start, so a world that runs the image and
    // forgets it is a world that will not come up — in a workflow that may only run weekly.
    @Test
    void whenAComposeFileRunsTheApplication_thenItConfiguresTheMailItCannotStartWithout()
            throws IOException {
        // given
        List<Path> sources;
        try (var deploymentFiles = Files.list(Path.of("deploy"))) {
            sources = deploymentFiles
                    .filter(path -> path.getFileName().toString().matches("compose(?:\\..+)?\\.yaml"))
                    .sorted()
                    .toList();
        }

        // when / then
        for (Path source : sources) {
            String compose = Files.readString(source);
            if (serviceBodies(compose).stream().noneMatch(ReferenceDeploymentSecurityTest::runsApplication)) {
                continue;
            }
            assertThat(compose)
                    .as("%s runs the application", source)
                    .contains("COURTSIDE_MAIL_RELAY_HOST")
                    .contains("COURTSIDE_MAIL_FROM")
                    .contains("COURTSIDE_MAIL_REPLY_TO");
        }
    }

    private static boolean runsApplication(String service) {
        return OWN_IMAGE_REFERENCES.stream().anyMatch(service::contains)
                && !service.contains("command: [\"--courtside-database-");
    }

    private static List<String> serviceBodies(String compose) {
        return SERVICE_BLOCK.matcher(compose).results()
                .map(match -> match.group("body"))
                .toList();
    }

    @Test
    void whenReadingCaddyfile_thenForwardedHeadersAreReplacedAtEveryUpstream() throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));
        Matcher headers = APPLICATION_HEADERS.matcher(caddyfile);

        // then
        assertThat(headers.find()).isTrue();
        assertThat(upstreamBodies(caddyfile)).isNotEmpty().allSatisfy(body -> {
            assertThat(body.lines().map(String::strip)
                    .filter("import applicationHeaders"::equals).count()).isEqualTo(1);
            assertThat(body.lines().map(String::strip))
                    .noneMatch(directive -> directive.startsWith("header_up"));
        });
        assertThat(headers.group("directives").lines().map(String::strip).toList()).containsExactly(
                "header_up -Forwarded",
                "header_up -X-Forwarded-Port",
                "header_up -X-Forwarded-Prefix",
                "header_up -X-Forwarded-Ssl",
                "header_up X-Forwarded-For {remote_host}",
                "header_up X-Forwarded-Host {host}",
                "header_up X-Forwarded-Proto {scheme}");
    }

    @Test
    void whenReadingProductionResponseBoundaries_thenServerImplementationsStayUnadvertised()
            throws IOException {
        // given
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));
        String compose = Files.readString(Path.of("deploy/compose.yaml"));
        List<String> productionSites = PRODUCTION_SITE_BLOCK.matcher(caddyfile).results()
                .map(match -> match.group("body"))
                .toList();

        // when / then
        assertThat(compose).containsPattern(
                "image: caddy:2-alpine@sha256:[a-f0-9]{64}");
        assertThat(productionSites).singleElement().satisfies(site -> {
            List<List<String>> headerBlocks = HEADER_BLOCK.matcher(site).results()
                    .map(match -> match.group("fields").lines().map(String::strip).toList())
                    .toList();
            assertThat(headerBlocks).singleElement().satisfies(headers -> assertThat(headers)
                    .contains("-Server", "-Via"));
        });
        assertReviewedResponseDirectives();
    }

    public static void assertReviewedResponseDirectives() throws IOException {
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));
        assertThat(reviewedResponseDirectives(caddyfile)).containsExactlyEntriesOf(Map.of(
                "plaintext", List.of("reverse_proxy app:8080 {", "import applicationHeaders"),
                "serve", List.of("reverse_proxy https://app:8080 {", "import applicationHeaders",
                        "transport http {",
                        "tls_trusted_ca_certs /etc/courtside/tls/app-authority/authority.pem"),
                "production", List.of("encode zstd gzip", "request_body {", "max_size 2MB", "header {",
                        "+Content-Security-Policy \"base-uri 'none'; frame-ancestors 'none'\"",
                        "Strict-Transport-Security \"max-age=31536000; includeSubDomains\"",
                        "X-Content-Type-Options nosniff", "X-Frame-Options DENY",
                        "Referrer-Policy strict-origin-when-cross-origin",
                        "Permissions-Policy \"geolocation=(), camera=(), microphone=()\"",
                        "-Server", "-Via", "handle_errors {", "header {", "Cache-Control \"no-store\"",
                        "Content-Security-Policy \"base-uri 'none'; frame-ancestors 'none'\"",
                        "Strict-Transport-Security \"max-age=31536000; includeSubDomains\"",
                        "X-Content-Type-Options nosniff", "X-Frame-Options DENY",
                        "Referrer-Policy strict-origin-when-cross-origin",
                        "Permissions-Policy \"geolocation=(), camera=(), microphone=()\"",
                        "-Server", "-Via",
                        "respond \"Request could not be completed.\" {http.error.status_code}",
                        "@unknownMethod {", "method QUERY", "path /api/*", "method @unknownMethod PATCH",
                        "import {$COURTSIDE_APP_TLS_MODE:plaintext}"),
                "plaintext-site", List.of("@mailHostname host {$COURTSIDE_MAIL_HOSTNAME}",
                        "handle @mailHostname {", "header {", "Cache-Control \"no-store\"",
                        "Content-Security-Policy \"base-uri 'none'; frame-ancestors 'none'\"", "-Location", "-Server", "-Via",
                        "respond 404", "@browserNavigation {", "host {$COURTSIDE_DOMAIN}", "method GET HEAD",
                        "path / /courts /login /initial-password /my-bookings /my-messages /account/security /admin /admin/* /index.html /assets/* /font-licenses.txt /icon.svg /manifest.webmanifest /sw.js /workbox-*.js",
                        "handle @browserNavigation {", "header {", "Cache-Control \"no-store\"",
                        "Content-Security-Policy \"base-uri 'none'; frame-ancestors 'none'\"", "-Server", "-Via",
                        "redir https://{$COURTSIDE_DOMAIN}{uri} permanent", "handle {", "header {",
                        "Cache-Control \"no-store\"", "Content-Security-Policy \"base-uri 'none'; frame-ancestors 'none'\"",
                        "-Location", "-Server", "-Set-Cookie", "-Via",
                        "respond \"Plain HTTP is not accepted.\" 400"),
                "mail-site", List.of("header {", "Content-Security-Policy \"base-uri 'none'; frame-ancestors 'none'\"",
                        "-Server", "-Via", "respond 404")));
    }

    @Test
    void whenReadingCaddyProductionDirectives_thenNestedAndSiblingBranchesCannotHide() {
        assertThat(caddyDirectives("""
                header {
                    -Server
                }
                handle_path /debug/* {
                    file_server
                }
                import plaintext
                """))
                .containsExactly("header {", "-Server", "handle_path /debug/* {", "file_server",
                        "import plaintext");
    }

    private static Map<String, List<String>> reviewedResponseDirectives(String caddyfile) {
        return Map.of(
                "plaintext", caddyDirectives(caddyBlockBody(caddyfile, "(plaintext) {")),
                "serve", caddyDirectives(caddyBlockBody(caddyfile, "(serve) {")),
                "production", caddyDirectives(caddyBlockBody(caddyfile, "{$COURTSIDE_DOMAIN} {")),
                "plaintext-site", caddyDirectives(caddyBlockBody(caddyfile, "http://:80 {")),
                "mail-site", caddyDirectives(caddyBlockBody(caddyfile, "{$COURTSIDE_MAIL_HOSTNAME} {")));
    }

    private static String caddyBlockBody(String caddyfile, String marker) {
        List<String> body = new ArrayList<>();
        int depth = 0;
        boolean found = false;
        for (String line : caddyfile.lines().toList()) {
            if (!found) {
                if (!line.strip().equals(marker)) {
                    continue;
                }
                found = true;
            } else if (depth > 0) {
                body.add(line);
            }
            for (char character : caddyStructure(line)) {
                depth += character == '{' ? 1 : character == '}' ? -1 : 0;
            }
            if (found && depth == 0) {
                if (!body.isEmpty()) {
                    body.remove(body.size() - 1);
                }
                return String.join("\n", body);
            }
        }
        throw new IllegalArgumentException("Missing or unclosed Caddy block: " + marker);
    }

    private static List<String> caddyDirectives(String blockBody) {
        List<String> directives = new ArrayList<>();
        int depth = 0;
        for (String line : blockBody.lines().toList()) {
            char[] structure = caddyStructure(line);
            String visible = new String(structure).strip();
            if (!visible.isBlank() && !visible.matches("}+") && !line.strip().equals("}")) {
                directives.add(line.strip());
            }
            for (char character : structure) {
                depth += character == '{' ? 1 : character == '}' ? -1 : 0;
            }
            assertThat(depth).as("Caddy directive depth after %s", line).isGreaterThanOrEqualTo(0);
        }
        assertThat(depth).as("final Caddy directive depth").isZero();
        return directives;
    }

    @Test
    @SuppressWarnings("unchecked")
    void whenReadingReferenceDeployment_thenEveryApplicationAndListenerIsInventoried()
            throws IOException {
        // given
        Map<String, Object> compose = new Yaml().load(Files.readString(Path.of("deploy/compose.yaml")));
        Map<String, Map<String, Object>> services = (Map<String, Map<String, Object>>) compose.get("services");

        // when / then
        assertThat(services.keySet()).containsExactly(
                "db", "app", "mail", "mail-certificate", "mail-reload", "mail-plan",
                "mail-bootstrap", "mail-configure", "mail-check", "proxy");
        assertThat(services.entrySet().stream()
                .filter(entry -> entry.getValue().containsKey("ports"))
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey,
                        entry -> entry.getValue().get("ports"))))
                .containsExactlyInAnyOrderEntriesOf(Map.of(
                        "app", List.of("127.0.0.1:${COURTSIDE_PORT:-8080}:8080"),
                        "mail", List.of("25:25", "127.0.0.1:${COURTSIDE_MAIL_ADMIN_PORT:-8081}:8080"),
                        "proxy", List.of("80:80", "443:443")));
        String architecture = Files.readString(Path.of("docs/security-assessment.md"));
        services.keySet().forEach(service -> assertThat(architecture)
                .as("the architecture map names service %s", service)
                .contains("`" + service + "`"));
        assertThat(architecture).contains(
                "browser-to-proxy", "proxy-to-application", "application-to-database",
                "source-to-image", "operator-to-evidence");
        assertThat(topLevelCaddyBlocks(Files.readString(Path.of("deploy/Caddyfile")))).containsExactly(
                        "(applicationHeaders)", "(plaintext)", "(serve)", "http://:80",
                        "{$COURTSIDE_DOMAIN}", "{$COURTSIDE_MAIL_HOSTNAME}");
    }

    @Test
    void whenReadingEveryCaddyfile_thenNoUpstreamDeletesAHeaderItAlsoAsserts() throws IOException {
        // when / then
        assertThat(deploymentCaddyfiles()).hasSizeGreaterThan(1).allSatisfy(path ->
                assertThat(caddyUpstreams(Files.readString(path)))
                        .as("%s deletes a header the same upstream asserts", path)
                        .allSatisfy(upstream -> assertThat(upstream.deleted())
                                .doesNotContainAnyElementsOf(upstream.asserted())));
    }

    @Test
    void whenReadingEveryCaddyfile_thenEveryApplicationUpstreamReplacesEveryForwardedHeader()
            throws IOException {
        // when / then
        assertThat(deploymentCaddyfiles()).hasSizeGreaterThan(1).allSatisfy(path ->
                assertThat(caddyUpstreams(Files.readString(path))).allSatisfy(upstream -> {
                    assertThat(APPLICATION_UPSTREAMS).as("%s proxies to the uninventoried %s",
                            path, upstream.destination()).containsKey(upstream.destination());
                    if (Boolean.TRUE.equals(APPLICATION_UPSTREAMS.get(upstream.destination()))) {
                        Set<String> replaced = new LinkedHashSet<>(upstream.deleted());
                        replaced.addAll(upstream.asserted());
                        assertThat(replaced).as("%s forwards a client value to %s",
                                path, upstream.destination()).containsAll(FORWARDED_HEADERS);
                    }
                }));
    }

    @Test
    void whenAnUpstreamHidesItsForwardedHandling_thenTheScanStillReadsIt() {
        // given
        String cancelling = """
                reverse_proxy app:8080 {
                \theader_up -X-Forwarded-For  # kept for safety
                \theader_up X-Forwarded-For {remote_host}
                }
                """;
        String imported = """
                (applicationHeaders) {
                \theader_up X-Forwarded-For {remote_host}
                }
                (plaintext) {
                \treverse_proxy app:8080 {
                \t\theader_up -X-Forwarded-For
                \t\timport applicationHeaders
                \t}
                }
                """;
        String sibling = """
                reverse_proxy app:8080 {
                \theader_up X-Forwarded-For {remote_host}
                }
                other.example {
                \theader_up -X-Forwarded-For
                }
                """;

        // when / then
        assertThat(caddyUpstreams(cancelling)).singleElement().satisfies(upstream -> {
            assertThat(upstream.destination()).isEqualTo("app:8080");
            assertThat(upstream.deleted()).contains("x-forwarded-for");
            assertThat(upstream.asserted()).contains("x-forwarded-for");
        });
        assertThat(caddyUpstreams(imported)).singleElement().satisfies(upstream ->
                assertThat(upstream.asserted()).contains("x-forwarded-for"));
        assertThat(caddyUpstreams(sibling)).singleElement().satisfies(upstream ->
                assertThat(upstream.deleted()).isEmpty());
    }

    private static List<Path> deploymentCaddyfiles() throws IOException {
        try (Stream<Path> deployment = Files.list(Path.of("deploy"))) {
            return deployment.filter(path -> path.getFileName().toString().startsWith("Caddyfile"))
                    .sorted().toList();
        }
    }

    private record CaddyBlock(String destination, String snippet, Set<String> deleted,
                              Set<String> asserted, List<String> imported) {
        private CaddyBlock(String opening) {
            this(upstreamDestination(opening), snippetName(opening),
                    new LinkedHashSet<>(), new LinkedHashSet<>(), new ArrayList<>());
        }
    }

    private record CaddyUpstream(String destination, Set<String> deleted, Set<String> asserted) {}

    private static String upstreamDestination(String opening) {
        Matcher upstream = UPSTREAM_DESTINATION.matcher(opening);
        return upstream.find() ? upstream.group("destination") : null;
    }

    private static String snippetName(String opening) {
        Matcher snippet = SNIPPET_NAME.matcher(opening);
        return snippet.find() ? snippet.group("name") : null;
    }

    private static List<CaddyUpstream> caddyUpstreams(String caddyfile) {
        List<CaddyBlock> blocks = new ArrayList<>();
        List<CaddyBlock> open = new ArrayList<>();
        for (String line : caddyfile.lines().toList()) {
            String directive = new String(caddyStructure(line)).strip();
            CaddyBlock block = open.isEmpty() ? null : open.getLast();
            if (block != null) {
                Matcher deletion = HEADER_DELETION.matcher(directive);
                if (deletion.matches()) block.deleted().add(deletion.group("name").toLowerCase(Locale.ROOT));
                Matcher assignment = HEADER_ASSIGNMENT.matcher(directive);
                if (assignment.matches()) block.asserted().add(assignment.group("name").toLowerCase(Locale.ROOT));
                Matcher imported = SNIPPET_IMPORT.matcher(directive);
                if (imported.matches()) block.imported().add(imported.group("name"));
            }
            for (char character : caddyStructure(line)) {
                if (character == '{') {
                    CaddyBlock opened = new CaddyBlock(directive);
                    blocks.add(opened);
                    open.add(opened);
                } else if (character == '}' && !open.isEmpty()) {
                    open.removeLast();
                }
            }
        }
        Map<String, CaddyBlock> snippets = new HashMap<>();
        blocks.stream().filter(block -> block.snippet() != null)
                .forEach(block -> snippets.put(block.snippet(), block));
        return blocks.stream().filter(block -> block.destination() != null)
                .map(block -> resolve(block, snippets))
                .toList();
    }

    private static CaddyUpstream resolve(CaddyBlock upstream, Map<String, CaddyBlock> snippets) {
        Set<String> deleted = new LinkedHashSet<>();
        Set<String> asserted = new LinkedHashSet<>();
        List<CaddyBlock> pending = new ArrayList<>(List.of(upstream));
        Set<String> visited = new LinkedHashSet<>();
        while (!pending.isEmpty()) {
            CaddyBlock block = pending.removeLast();
            deleted.addAll(block.deleted());
            asserted.addAll(block.asserted());
            block.imported().stream().filter(visited::add).map(snippets::get)
                    .filter(java.util.Objects::nonNull).forEach(pending::add);
        }
        return new CaddyUpstream(upstream.destination(), deleted, asserted);
    }

    @Test
    void whenReadingCaddyTopLevelBlocks_thenLayoutAndCommentsCannotHideAnApplication() {
        assertThat(topLevelCaddyBlocks("""
                {
                    admin off
                }
                (applicationHeaders) {
                    header_up X-Forwarded-For {remote_host}
                }
                    extra.example { # additional site
                    respond 200
                }
                """)).containsExactly("(applicationHeaders)", "extra.example");
        assertThatThrownBy(() -> topLevelCaddyBlocks("import extra.caddy"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Uninventoried top-level Caddy syntax");
    }

    private static List<String> topLevelCaddyBlocks(String caddyfile) {
        List<String> blocks = new ArrayList<>();
        int depth = 0;
        for (String line : caddyfile.lines().toList()) {
            char[] structure = caddyStructure(line);
            int startingDepth = depth;
            boolean containsStructuralBrace = false;
            for (int index = 0; index < structure.length; index++) {
                if (structure[index] == '{') {
                    containsStructuralBrace = true;
                    if (depth == 0) {
                        String name = line.substring(0, index).strip();
                        if (!name.isEmpty()) {
                            blocks.add(name);
                        }
                    }
                    depth++;
                } else if (structure[index] == '}') {
                    containsStructuralBrace = true;
                    depth--;
                }
            }
            assertThat(depth).as("Caddy block depth after %s", line).isGreaterThanOrEqualTo(0);
            if (startingDepth == 0 && !containsStructuralBrace
                    && !new String(structure).isBlank()) {
                throw new IllegalArgumentException("Uninventoried top-level Caddy syntax: " + line.strip());
            }
        }
        assertThat(depth).as("final Caddy block depth").isZero();
        return blocks;
    }

    private static char[] caddyStructure(String line) {
        char[] structure = line.toCharArray();
        boolean quoted = false;
        boolean escaped = false;
        for (int index = 0; index < structure.length; index++) {
            char current = structure[index];
            if (!quoted && current == '#') {
                Arrays.fill(structure, index, structure.length, ' ');
                break;
            }
            if (current == '"' && !escaped) {
                quoted = !quoted;
                structure[index] = ' ';
            } else if (quoted) {
                structure[index] = ' ';
            }
            escaped = current == '\\' && !escaped;
            if (current != '\\') {
                escaped = false;
            }
        }
        for (int start = 0; start < structure.length; start++) {
            if (structure[start] != '{' || start + 1 >= structure.length
                    || !(structure[start + 1] == '$' || Character.isLetter(structure[start + 1]))) {
                continue;
            }
            int end = start + 2;
            while (end < structure.length && structure[end] != '}' && !Character.isWhitespace(structure[end])) {
                end++;
            }
            if (end < structure.length && structure[end] == '}') {
                structure[start] = ' ';
                structure[end] = ' ';
                start = end;
            }
        }
        return structure;
    }

    // An upstream that imported the snippet and then added a header_up of its own would put the
    // client's value back, and an equal number of imports and upstreams would not notice.
    private static List<String> upstreamBodies(String caddyfile) {
        List<String> bodies = new ArrayList<>();
        Matcher upstream = UPSTREAM.matcher(caddyfile);
        while (upstream.find()) {
            int depth = 0;
            for (int cursor = upstream.end() - 1; cursor < caddyfile.length(); cursor++) {
                char character = caddyfile.charAt(cursor);
                depth += character == '{' ? 1 : character == '}' ? -1 : 0;
                if (depth == 0) {
                    bodies.add(caddyfile.substring(upstream.end(), cursor));
                    break;
                }
            }
        }
        return bodies;
    }

    @Test
    void whenReadingSecurityCaddyfile_thenProductionProxyTrustBoundaryIsPreserved() throws IOException {
        // given
        String production = Files.readString(Path.of("deploy/Caddyfile"));
        String security = Files.readString(Path.of("deploy/Caddyfile.security"));
        Matcher productionProxy = REVERSE_PROXY_BLOCK.matcher(production);
        Matcher securityProxy = REVERSE_PROXY_BLOCK.matcher(security);

        // when / then
        assertThat(productionProxy.find()).isTrue();
        assertThat(securityProxy.find()).isTrue();
        assertThat(securityProxy.group("directives").lines().map(String::strip).toList())
                .containsExactly("header_up Host localhost",
                        "header_up -Forwarded",
                        "header_up -X-Forwarded-Port",
                        "header_up -X-Forwarded-Prefix",
                        "header_up -X-Forwarded-Ssl",
                        "header_up X-Forwarded-For {remote_host}",
                        "header_up X-Forwarded-Host localhost",
                        "header_up X-Forwarded-Proto {scheme}");
        assertThat(security)
                .contains("X-Content-Type-Options nosniff", "X-Frame-Options DENY",
                        "Referrer-Policy strict-origin-when-cross-origin",
                        "Permissions-Policy \"geolocation=(), camera=(), microphone=()\"")
                .doesNotContain("Strict-Transport-Security");
    }

    @Test
    void whenReadingCaddyfile_thenRequestBodiesHaveABoundedSize() throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));
        String uatCaddyfile = Files.readString(Path.of("deploy/Caddyfile.uat"));

        // then
        assertThat(caddyfile).contains("request_body {\n\t\tmax_size 2MB\n\t}");
        assertThat(uatCaddyfile.lines().filter(line -> line.strip().equals("max_size 2MB")).count())
                .isEqualTo(2);
    }

    @Test
    void givenTheApiHasNoPatchOperation_whenReadingProxiedDeployments_thenUnknownMethodsReachSpringAsPatch()
            throws IOException {
        // given
        String api = Files.readString(Path.of("src/main/resources/api/openapi.yaml"));

        // when / then
        assertThat(api).doesNotContain("    patch:");
        for (String name : List.of(
                "Caddyfile", "Caddyfile.dev", "Caddyfile.perf", "Caddyfile.security", "Caddyfile.uat")) {
            assertThat(Files.readString(Path.of("deploy", name)))
                    .as(name)
                    .contains("@unknownMethod {", "method QUERY", "path /api/*", "method @unknownMethod PATCH");
        }
    }

    @Test
    void whenReadingCaddyfile_thenTheApplicationContentSecurityPolicyIsNotReplaced() throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));

        // then
        assertThat(caddyfile)
                .contains("+Content-Security-Policy \"base-uri 'none'; frame-ancestors 'none'\"")
                .doesNotContain("Content-Security-Policy \"default-src");
    }

    @Test
    void givenProductionTraffic_whenReadingEdgeHeaders_thenBrowserPoliciesAreGlobalAndExact()
            throws IOException {
        // given
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));

        // when
        List<String> headers = headerDirectives(caddyfile, PRODUCTION_SITE_BLOCK);

        // then
        assertThat(headers).contains(
                "Strict-Transport-Security \"max-age=31536000; includeSubDomains\"",
                "X-Content-Type-Options nosniff",
                "Referrer-Policy strict-origin-when-cross-origin");
    }

    @Test
    void whenReadingPublicPlaintextListeners_thenOnlyKnownSafeNavigationsRedirect() throws IOException {
        // given
        String production = Files.readString(Path.of("deploy/Caddyfile"));
        String uat = Files.readString(Path.of("deploy/Caddyfile.uat"));

        // when / then
        for (var source : List.of(
                new PlaintextSource(production, PRODUCTION_PLAINTEXT_SITE_BLOCK,
                        "https://{$COURTSIDE_DOMAIN}{uri}"),
                new PlaintextSource(uat, UAT_PLAINTEXT_SITE_BLOCK, "https://localhost:8443{uri}"))) {
            Matcher site = source.pattern().matcher(source.caddyfile());
            assertThat(site.find()).isTrue();
            assertThat(site.group("body"))
                    .contains("method GET HEAD", "path / /courts /login", source.redirectTarget(),
                            "respond \"Plain HTTP is not accepted.\" 400",
                            "Content-Security-Policy \"base-uri 'none'; frame-ancestors 'none'\"",
                            "-Location", "-Set-Cookie", "-Server", "-Via")
                    .doesNotContain("reverse_proxy", "{host}", "header Accept", "header User-Agent",
                            "header Sec-Fetch");
            assertThat(source.caddyfile())
                    .startsWith("{\n\tauto_https disable_redirects\n}")
                    .doesNotContain("auto_https off", "auto_https disable_certs");
        }
        assertThat(production)
                .contains("@mailHostname host {$COURTSIDE_MAIL_HOSTNAME}")
                .contains("{$COURTSIDE_MAIL_HOSTNAME} {");
    }

    @Test
    void givenTheProductionHostname_whenReadingCaddyfile_thenPublicCertificateAutomationRemainsEnabled()
            throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));

        // then
        assertThat(caddyfile)
                .contains("{$COURTSIDE_DOMAIN} {")
                .doesNotContain("tls internal", "tls self_signed", "issuer internal", "local_certs",
                        "auto_https off", "auto_https disable_certs");
    }

    private record PlaintextSource(String caddyfile, Pattern pattern, String redirectTarget) {
    }

    @Test
    void whenReadingSecurityHeaderDocumentation_thenApplicationAndProxyResponsibilitiesStayDistinct()
            throws IOException {
        // given
        String deploymentGuide = normalized(Files.readString(Path.of("deploy/README.md")));
        String design = normalized(Files.readString(Path.of("docs/design.md")));

        // when / then
        for (String document : List.of(deploymentGuide, design)) {
            assertThat(document)
                    .contains("application sets `Content-Security-Policy`, "
                            + "`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and "
                            + "`Referrer-Policy: strict-origin-when-cross-origin` on its own responses")
                    .contains("Spring Security also sets `Strict-Transport-Security`")
                    .contains("Caddy repeats nosniff, frame denial and the referrer policy at the edge")
                    .contains("`Permissions-Policy` is the only response policy here that comes only from Caddy");
        }
        assertThat(deploymentGuide)
                .contains("Funnel keeps the application's headers")
                .contains("keeps those five application headers when Funnel supplies the trusted HTTPS "
                        + "forwarding signal")
                .contains("loses only Caddy's `Permissions-Policy` response header")
                .doesNotContain("Without the proxy there is no HSTS");
    }

    private static String normalized(String document) {
        return document.replaceAll("\\s+", " ").strip();
    }

    @Test
    void whenReadingEveryCaddyfile_thenProxyImplementationDisclosureIsRemoved() throws IOException {
        // given
        List<Path> caddyfiles;
        try (var deploymentFiles = Files.list(Path.of("deploy"))) {
            caddyfiles = deploymentFiles
                    .filter(path -> path.getFileName().toString().startsWith("Caddyfile"))
                    .sorted()
                    .toList();
        }

        // when / then
        for (Path caddyfile : caddyfiles) {
            assertThat(Files.readString(caddyfile))
                    .as("%s removes proxy implementation disclosure", caddyfile)
                    .contains("-Via");
        }
    }

    @Test
    void whenReadingEveryCaddyfile_thenTheSecurityHeadersAgree() throws IOException {
        assertEveryCaddyfileFramesResponses();
        // when
        String production = Files.readString(Path.of("deploy/Caddyfile"));
        String uat = Files.readString(Path.of("deploy/Caddyfile.uat"));
        List<String> productionHeaders = headerDirectives(production, PRODUCTION_SITE_BLOCK);
        List<String> uatHeaders = headerDirectives(uat, UAT_PUBLIC_SITE_BLOCK);
        List<String> expectedUatHeaders = productionHeaders.stream()
                .filter(directive -> !fieldName(directive).equals("Strict-Transport-Security"))
                .toList();

        // then
        assertThat(uatHeaders)
                .as("Caddyfile.uat's public https://localhost block omits Strict-Transport-Security "
                        + "because HSTS is host- not port-scoped: setting it there would force every "
                        + "other localhost port in the same browser into HTTPS for the max-age duration")
                .containsExactlyInAnyOrderElementsOf(expectedUatHeaders);
    }

    public static void assertEveryCaddyfileFramesResponses() throws IOException {
        List<String> policies;
        try (var deploymentFiles = Files.list(Path.of("deploy"))) {
            policies = deploymentFiles
                    .filter(path -> path.getFileName().toString().startsWith("Caddyfile"))
                    .flatMap(path -> {
                        try {
                            return Files.readAllLines(path).stream();
                        } catch (IOException exception) {
                            throw new java.io.UncheckedIOException(exception);
                        }
                    })
                    .map(String::strip)
                    .filter(line -> line.startsWith("Content-Security-Policy ")
                            || line.startsWith("+Content-Security-Policy "))
                    .toList();
        }
        assertThat(policies).isNotEmpty().allSatisfy(policy -> assertThat(policy)
                .contains("frame-ancestors 'none'"));
    }

    private static List<String> headerDirectives(String caddyfile, Pattern siteBlock) {
        Matcher site = siteBlock.matcher(caddyfile);
        assertThat(site.find()).isTrue();
        Matcher header = HEADER_BLOCK.matcher(site.group("body"));
        assertThat(header.find()).isTrue();
        return header.group("fields").lines()
                .map(String::strip)
                .toList();
    }

    private static String fieldName(String directive) {
        String token = directive.split("\\s+", 2)[0];
        return token.startsWith("-") ? token.substring(1) : token;
    }
}
