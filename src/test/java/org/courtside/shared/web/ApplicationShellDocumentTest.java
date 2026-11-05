package org.courtside.shared.web;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ApplicationShellDocumentTest {

    private static final String SHELL = """
            <!doctype html>
            <html lang="de">
              <head>
                <title>Courtside</title>
              </head>
              <body></body>
            </html>
            """;

    @Test
    void givenAClubText_whenTheShellIsWritten_thenItCarriesTheClubsLanguageAndDescription() {
        // when
        String written = SpaConfiguration.ApplicationShell.withClubText(SHELL, "en", "Book courts at Example Tennis Club");

        // then
        assertThat(written).contains("<html lang=\"en\">")
                .contains("<meta name=\"description\" content=\"Book courts at Example Tennis Club\" />")
                .doesNotContain("lang=\"de\"");
    }

    @Test
    void givenMarkupInTheClubName_whenTheShellIsWritten_thenItStaysText() {
        // when
        String written = SpaConfiguration.ApplicationShell.withClubText(SHELL, "de",
                "Plätze buchen bei \"Example\" <Tennis> & Club");

        // then
        assertThat(written).as("the name cannot leave the attribute")
                .contains("content=\"Plätze buchen bei &quot;Example&quot; &lt;Tennis&gt; &amp; Club\"");
    }

    @Test
    void givenAShellWithoutTheExpectedMarkup_whenItIsWritten_thenItIsServedUnchanged() {
        // when / then
        assertThat(SpaConfiguration.ApplicationShell.withClubText("built /index.html", "en", "Book courts"))
                .isEqualTo("built /index.html");
    }
}
