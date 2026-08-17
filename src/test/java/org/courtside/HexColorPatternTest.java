package org.courtside;

import jakarta.validation.constraints.Pattern;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;

import static org.assertj.core.api.Assertions.assertThat;

class HexColorPatternTest {

    @Test
    void whenReadingEveryHexColorPatternCopy_thenTheyAllAgreeWithBookingCardsColorCheck()
            throws IOException, ReflectiveOperationException {
        // given
        String canonical = sqlCheckRegex("V2__booking_card.sql", "color");

        // when / then
        assertThat(sqlCheckRegex("V9__club_config.sql", "primary_color"))
                .as("club_config_primary_color_hex has drifted from booking_card_color_hex")
                .isEqualTo(canonical);
        assertThat(sqlCheckRegex("V9__club_config.sql", "accent_color"))
                .as("club_config_accent_color_hex has drifted from booking_card_color_hex")
                .isEqualTo(canonical);
        assertThat(accessorPattern("org.courtside.api.ApiBookingCardRequest", "getColor"))
                .as("BookingCardRequest.color's pattern in the API document has drifted from "
                        + "booking_card_color_hex")
                .isEqualTo(canonical);
        assertThat(accessorPattern("org.courtside.api.ApiClubConfigRequest", "getPrimaryColor"))
                .as("ClubConfigRequest.primaryColor's pattern in the API document has drifted from "
                        + "booking_card_color_hex")
                .isEqualTo(canonical);
        assertThat(accessorPattern("org.courtside.api.ApiClubConfigRequest", "getAccentColor"))
                .as("ClubConfigRequest.accentColor's pattern in the API document has drifted from "
                        + "booking_card_color_hex")
                .isEqualTo(canonical);
    }

    private static String sqlCheckRegex(String migrationFileName, String columnName) throws IOException {
        String content = Files.readString(
                Path.of("src/main/resources/db/migration", migrationFileName));
        Matcher matcher = java.util.regex.Pattern
                .compile(java.util.regex.Pattern.quote(columnName) + " ~ '([^']+)'")
                .matcher(content);
        assertThat(matcher.find())
                .as("%s must contain a CHECK on %s ~ '...'", migrationFileName, columnName)
                .isTrue();
        return matcher.group(1);
    }

    // Read off the generated accessor rather than the document: that is where the pattern ends up
    // enforcing anything, and it proves the document actually reached the code.
    private static String accessorPattern(String className, String accessorName)
            throws ReflectiveOperationException {
        Method accessor = Class.forName(className).getDeclaredMethod(accessorName);
        return accessor.getAnnotation(Pattern.class).regexp();
    }
}
