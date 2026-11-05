package org.courtside.shared.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.TestApplicationBuild;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(ConfigTestFixture.class)
class ApplicationShellDescriptionTest extends AbstractIntegrationTest {

    private static final Path BUILD = withTheShippedShell(TestApplicationBuild.create());

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private ConfigTestFixture config;

    private MockMvc mockMvc;

    @DynamicPropertySource
    static void serveTheBuild(DynamicPropertyRegistry registry) {
        registry.add(TestApplicationBuild.STATIC_LOCATIONS, () -> BUILD.toUri().toString());
    }

    @AfterAll
    static void removeTheBuild() {
        TestApplicationBuild.delete(BUILD);
    }

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAGermanClub_whenTheCourtPlanIsOpened_thenTheShellDescribesTheClubInGerman() throws Exception {
        // given
        config.nameTheClub("Example Tennis Club");
        config.speak("de");

        // when
        String shell = mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        // then
        assertThat(shell).contains("<html lang=\"de\">")
                .as("the document declares UTF-8 ahead of the description")
                .contains("<meta name=\"description\" content=\"Plätze buchen bei Example Tennis Club\" />");
    }

    @Test
    void givenTheClubRenamedAndSpeakingEnglish_whenTheShellIsOpenedAgain_thenItCarriesTheNewTextAtOnce() throws Exception {
        // given
        mockMvc.perform(get("/courts")).andExpect(status().isOk());
        config.nameTheClub("Example Racket Club");
        config.speak("en");

        // when / then
        mockMvc.perform(get("/courts"))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Last-Modified"))
                .andExpect(content().string(containsString("<html lang=\"en\">")))
                .andExpect(content().string(containsString(
                        "<meta name=\"description\" content=\"Book courts at Example Racket Club\" />")));
    }

    private static Path withTheShippedShell(Path build) {
        try {
            Files.copy(Path.of("frontend/index.html"), build.resolve("index.html"),
                    StandardCopyOption.REPLACE_EXISTING);
            return build;
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }
}
