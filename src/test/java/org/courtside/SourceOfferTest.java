package org.courtside;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// An offer is only worth something if it names a version and a place: a 200 carrying nulls would
// satisfy the schema and discharge nothing.
class SourceOfferTest extends AbstractIntegrationTest {

    private static final Pattern POM_URL = Pattern.compile("\n {4}<url>([^<]+)</url>");

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenNobodyIsLoggedIn_whenAskingWhereTheSourceIs_thenTheAnswerNamesAVersionAndAPlace()
            throws Exception {
        // given / when
        String body = mockMvc.perform(get("/api/source"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(JsonPath.<String>read(body, "$.version"))
                .as("the version this instance was built as")
                .isNotBlank();
        assertThat(JsonPath.<String>read(body, "$.sourceUrl"))
                .as("where the corresponding source can be obtained")
                .startsWith("http");
    }

    @Test
    void whenTheBuildHadARepository_thenTheAnswerNamesTheCommitItWasBuiltFrom() throws Exception {
        // given — a fork running unreleased code is the case section 13 is about, and the
        // version alone identifies nothing while releases are unnumbered
        mockMvc.perform(get("/api/source"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commit").value(org.hamcrest.Matchers.matchesPattern("[0-9a-f]{40}")));
    }

    @Test
    void whenNobodyOverrodeIt_thenTheSourceUrlIsTheOneTheProjectDeclares() throws IOException, Exception {
        // given — application.yaml takes the pom's <url> by resource filtering, and a build that
        // stopped filtering would ship the placeholder, which is a link to nowhere
        Matcher declared = POM_URL.matcher(Files.readString(Path.of("pom.xml")));
        assertThat(declared.find()).as("pom.xml must declare the project url").isTrue();

        // when / then
        mockMvc.perform(get("/api/source"))
                .andExpect(jsonPath("$.sourceUrl").value(declared.group(1)));
    }
}
