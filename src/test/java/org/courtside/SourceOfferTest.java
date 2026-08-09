package org.courtside;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SourceOfferTest extends AbstractIntegrationTest {

    private static final Pattern POM_URL = Pattern.compile("<url>(https?://[^<]+)</url>");

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
    void whenAskingWhereTheSourceIs_thenTheCommitIsTheOneTheBuildRecorded() throws Exception {
        // given — the build tolerates having no repository to read, so the endpoint must report
        // whatever git.properties ended up holding, including nothing
        String recorded = whatTheBuildRecorded();

        // when / then
        mockMvc.perform(get("/api/source"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commit").value(recorded));
    }

    private static String whatTheBuildRecorded() throws IOException {
        Properties git = new Properties();
        try (InputStream in = new ClassPathResource("git.properties").getInputStream()) {
            git.load(in);
        }
        return git.getProperty("git.commit.id");
    }

    @Test
    void whenNobodyOverrodeIt_thenTheSourceUrlIsTheOneTheProjectDeclares() throws Exception {
        // given — a build that stopped filtering @project.url@ would ship the placeholder
        Matcher declared = POM_URL.matcher(Files.readString(Path.of("pom.xml")));
        assertThat(declared.find()).as("pom.xml must declare the project url").isTrue();

        // when / then
        mockMvc.perform(get("/api/source"))
                .andExpect(jsonPath("$.sourceUrl").value(declared.group(1)));
    }
}
