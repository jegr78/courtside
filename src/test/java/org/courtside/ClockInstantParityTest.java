package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class ClockInstantParityTest {

    private static final Path INTEGRATION_TEST_CLOCK =
            Path.of("src/test/java/org/courtside/FixedClockConfiguration.java");
    private static final Path BROWSER_JOURNEY_SETUP = Path.of("frontend/e2e/global-setup.ts");

    private static final Pattern INTEGRATION_TEST_INSTANT =
            Pattern.compile("courtside\\.test\\.clock:([0-9T:.Z-]+)");
    private static final Pattern BROWSER_JOURNEY_INSTANT =
            Pattern.compile("journeyInstant\\s*=\\s*\"([0-9T:.Z-]+)\"");

    @Test
    void whenBothSuitesFixTheirClock_thenTheyNameTheSameInstant() throws IOException {
        // when
        String integrationInstant = instantIn(INTEGRATION_TEST_CLOCK, INTEGRATION_TEST_INSTANT);
        String journeyInstant = instantIn(BROWSER_JOURNEY_SETUP, BROWSER_JOURNEY_INSTANT);

        // then
        assertThat(journeyInstant)
                .as("one project has one test date: %s fixes the clock for the integration tests "
                        + "and %s for the browser journey, and a reader reasoning about \"now\" "
                        + "must not get two answers",
                        INTEGRATION_TEST_CLOCK, BROWSER_JOURNEY_SETUP)
                .isEqualTo(integrationInstant);
    }

    private static String instantIn(Path file, Pattern instant) throws IOException {
        Matcher matcher = instant.matcher(Files.readString(file));
        assertThat(matcher.find())
                .as("%s must name the fixed instant this test can read", file)
                .isTrue();
        return matcher.group(1);
    }
}
