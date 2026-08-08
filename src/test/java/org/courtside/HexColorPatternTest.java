package org.courtside;

import jakarta.validation.constraints.Pattern;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;

import static org.assertj.core.api.Assertions.assertThat;

class HexColorPatternTest {

    @Test
    void whenReadingEveryHexColorPatternCopy_thenTheyAllAgreeWithBookingCardsColorCheck()
            throws IOException, ReflectiveOperationException {
        // given — booking_card.color is the oldest of the five hand-written copies of this pattern
        String canonical = sqlCheckRegex("V2__booking_card.sql", "color");

        // when / then
        assertThat(sqlCheckRegex("V9__club_config.sql", "primary_color"))
                .as("club_config_primary_color_hex has drifted from booking_card_color_hex")
                .isEqualTo(canonical);
        assertThat(sqlCheckRegex("V9__club_config.sql", "accent_color"))
                .as("club_config_accent_color_hex has drifted from booking_card_color_hex")
                .isEqualTo(canonical);
        assertThat(fieldPattern(
                "org.courtside.card.web.CardAdminWebModels$BookingCardRequest", "color"))
                .as("CardAdminWebModels.BookingCardRequest.color's @Pattern has drifted from "
                        + "booking_card_color_hex")
                .isEqualTo(canonical);
        assertThat(fieldPattern(
                "org.courtside.config.web.ConfigWebModels$ConfigRequest", "primaryColor"))
                .as("ConfigWebModels.ConfigRequest.primaryColor's @Pattern has drifted from "
                        + "booking_card_color_hex")
                .isEqualTo(canonical);
        assertThat(fieldPattern(
                "org.courtside.config.web.ConfigWebModels$ConfigRequest", "accentColor"))
                .as("ConfigWebModels.ConfigRequest.accentColor's @Pattern has drifted from "
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

    private static String fieldPattern(String className, String fieldName) throws ReflectiveOperationException {
        Field field = Class.forName(className).getDeclaredField(fieldName);
        return field.getAnnotation(Pattern.class).regexp();
    }
}
