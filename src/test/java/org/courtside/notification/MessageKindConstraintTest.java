package org.courtside.notification;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.Arrays;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class MessageKindConstraintTest extends AbstractIntegrationTest {

    private static final Pattern QUOTED = Pattern.compile("'([A-Z_]+)'");

    @Autowired
    private JdbcClient jdbc;

    @ParameterizedTest
    @ValueSource(strings = {"message_record_kind_known", "notification_kind_known"})
    void whenTheSchemaIsRead_thenEveryMessageKindIsOneTheTableAccepts(String constraint) {
        // when
        Set<String> accepted = namesIn(constraint);

        // then
        assertThat(accepted)
                .as("%s names exactly the message kinds, so a migration cannot drop one a later kind's rewrite forgot",
                        constraint)
                .isEqualTo(Arrays.stream(MessageKind.values()).map(Enum::name).collect(Collectors.toSet()));
    }

    @Test
    void whenTheSchemaIsRead_thenAnOptOutCanNameExactlyTheDeclinableKinds() {
        // when
        Set<String> accepted = namesIn("message_optout_kind_declinable");

        // then
        assertThat(accepted).isEqualTo(Arrays.stream(MessageKind.values())
                .filter(MessageKind::isDeclinable).map(Enum::name).collect(Collectors.toSet()));
    }

    private Set<String> namesIn(String constraint) {
        String definition = jdbc.sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = :name")
                .param("name", constraint)
                .query(String.class)
                .single();
        Matcher names = QUOTED.matcher(definition);
        return names.results().map(match -> match.group(1)).collect(Collectors.toSet());
    }
}
