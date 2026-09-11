package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SessionVariableScopeTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenEveryAttributeThisApplicationWrites_whenTheirWritersAndAuthorityAreReviewed_thenEachHasOnePurpose()
            throws Exception {
        // given
        List<String> writers = attributeWriters();
        MockHttpSession planted = new MockHttpSession();
        planted.setAttribute("courtside.authenticated-at", Long.MAX_VALUE);
        planted.setAttribute("courtside.browser-family", "CHROME");

        // The third writer names a request attribute, which is gone with the request that carried it.

        // when / then
        assertThat(writers).containsExactly(
                "org/courtside/identity/RecentAuthentication.java:.setAttribute(AUTHENTICATED_AT, clock.instant().toEpochMilli());",
                "org/courtside/identity/internal/SecurityConfiguration.java:request.getSession(true).setAttribute(AccountSessionService.BROWSER_FAMILY,",
                "org/courtside/shared/web/RefusesAmbiguity.java:request.setAttribute(DETAIL, QUOTABLE.matcher(name).matches()");
        mockMvc.perform(get("/api/account/sessions").session(planted))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    private static List<String> attributeWriters() throws IOException {
        Path root = Path.of("src/main/java");
        try (var files = Files.walk(root)) {
            return files.filter(path -> path.toString().endsWith(".java"))
                    .flatMap(path -> attributeWriters(root, path).stream())
                    .sorted()
                    .toList();
        }
    }

    private static List<String> attributeWriters(Path root, Path path) {
        try {
            String relative = root.relativize(path).toString().replace('\\', '/');
            return Files.readAllLines(path).stream()
                    .map(String::trim)
                    .filter(line -> line.contains(".setAttribute("))
                    .map(line -> relative + ":" + line)
                    .toList();
        } catch (IOException failure) {
            throw new IllegalStateException("Could not read " + path, failure);
        }
    }
}
