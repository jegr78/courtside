package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

// Three columns hold the name of a Java enum constant. A CHECK is what keeps the database's idea
// of the allowed set from drifting away from the enum's — and since the entity reads the column
// back through @Enumerated, a value outside the set is no longer a quiet "nobody holds that role"
// but an exception on load. The list in the migration is hand-written, so this test is what ties
// it to its source.
class EnumeratedColumnInListPatternTest {

    @Test
    void whenReadingTheRuleDefinitionRuleTypeInList_thenItAcceptsExactlyTheRuleTypeEnumConstants()
            throws IOException, ReflectiveOperationException {
        // given
        String expected = enumValuesOf("org.courtside.rules.internal.RuleType");

        // when
        String actual = sqlInListValues("V5__rules.sql", "rule_type");

        // then
        assertThat(actual)
                .as("rule_definition_rule_type_known has drifted from org.courtside.rules.internal.RuleType")
                .isEqualTo(expected);
    }

    @Test
    void whenReadingTheBookingCardRequiredRoleInList_thenItAcceptsExactlyTheRoleEnumConstants()
            throws IOException, ReflectiveOperationException {
        // given
        String expected = enumValuesOf("org.courtside.identity.Role");

        // when
        String actual = sqlInListValues("V2__booking_card.sql", "required_role");

        // then
        assertThat(actual)
                .as("booking_card_required_role_known has drifted from org.courtside.identity.Role")
                .isEqualTo(expected);
    }

    @Test
    void whenReadingTheUserAccountRoleInList_thenItAcceptsExactlyTheRoleEnumConstants()
            throws IOException, ReflectiveOperationException {
        // given
        String expected = enumValuesOf("org.courtside.identity.Role");

        // when
        String actual = sqlInListValues("V4__identity.sql", "role");

        // then
        assertThat(actual)
                .as("user_account_role_role_known has drifted from org.courtside.identity.Role")
                .isEqualTo(expected);
    }

    private static String enumValuesOf(String className) throws ReflectiveOperationException {
        Class<?> type = Class.forName(className);
        return Arrays.stream(type.getEnumConstants())
                .map(Object::toString)
                .sorted()
                .collect(Collectors.joining(","));
    }

    private static String sqlInListValues(String migrationFileName, String columnName) throws IOException {
        String content = Files.readString(Path.of("src/main/resources/db/migration", migrationFileName));
        Matcher matcher = Pattern
                .compile(Pattern.quote(columnName) + "\\s+IN\\s+\\(([^)]+)\\)")
                .matcher(content);
        assertThat(matcher.find())
                .as("%s must contain a CHECK on %s IN (...)", migrationFileName, columnName)
                .isTrue();
        List<String> values = Arrays.stream(matcher.group(1).split(","))
                .map(value -> value.trim().replace("'", ""))
                .sorted()
                .toList();
        return String.join(",", values);
    }
}
