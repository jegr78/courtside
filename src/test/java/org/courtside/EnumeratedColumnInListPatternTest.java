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

// rule_type and role are each backed by a real Java enum, the same shape RequiredRolePatternTest
// and RolePrefixPatternTest already use to tie a duplicated literal back to its source.
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
