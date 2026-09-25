package org.courtside.config.internal;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class InstalledAppPageColorTest {

    @Test
    void whenComparingTheSplashScreenWithTheStylesheet_thenBothPaintTheDefaultPageColour() throws IOException {
        // given
        String styles = Files.readString(Path.of("frontend/src/styles.css"));
        String root = styles.substring(styles.indexOf(":root {"), styles.indexOf("}", styles.indexOf(":root {")));

        // when
        Matcher page = Pattern.compile("--cs-page:\\s*(#[0-9a-fA-F]{6});").matcher(root);

        // then
        assertThat(page.find()).as("the default theme in styles.css declares --cs-page").isTrue();
        assertThat(InstalledAppService.PAGE_COLOR)
                .as("the manifest's background_color must be the page colour the app paints first")
                .isEqualToIgnoringCase(page.group(1));
    }
}
