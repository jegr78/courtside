package org.courtside.notification;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

// A kind the schema has not heard of is refused at the moment somebody is written to, which is
// where it is least welcome and furthest from the change that introduced it.
class MessageKindSchemaParityTest extends AbstractIntegrationTest {

    private static final Pattern QUOTED = Pattern.compile("'([A-Z_]+)'");

    @Autowired
    private JdbcClient jdbc;

    @Test
    void whenAKindIsAdded_thenTheMessageLogAlreadyAcceptsIt() {
        // when / then
        assertThat(namesIn("message_record_kind_known"))
                .containsExactlyInAnyOrderElementsOf(
                        Arrays.stream(MessageKind.values()).map(Enum::name).toList());
    }

    @Test
    void whenAKindMayBeSwitchedOff_thenTheOptOutTableAcceptsExactlyThose() {
        // when / then
        assertThat(namesIn("message_optout_kind_declinable"))
                .containsExactlyInAnyOrderElementsOf(Arrays.stream(MessageKind.values())
                        .filter(MessageKind::isDeclinable)
                        .map(Enum::name)
                        .toList());
    }

    private List<String> namesIn(String constraint) {
        String definition = jdbc.sql("""
                        SELECT pg_get_constraintdef(oid)
                        FROM pg_constraint
                        WHERE conname = :constraint
                        """)
                .param("constraint", constraint)
                .query(String.class)
                .single();
        Matcher quoted = QUOTED.matcher(definition);
        return quoted.results().map(result -> result.group(1)).toList();
    }
}
