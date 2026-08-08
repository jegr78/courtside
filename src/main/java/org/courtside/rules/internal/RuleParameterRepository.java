package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
@RequiredArgsConstructor
public class RuleParameterRepository {

    private final JdbcClient jdbc;

    public Optional<Integer> findIntParameter(UUID membershipTypeId, RuleType type, String key) {
        if (membershipTypeId == null) {
            return Optional.empty();
        }
        return jdbc.sql("""
                        SELECT (rd.params ->> :key)::int
                        FROM membership_type mt
                        JOIN rule_definition rd ON rd.rule_set_id = mt.rule_set_id
                        WHERE mt.id = :membershipTypeId
                          AND rd.rule_type = :ruleType
                        """)
                .param("key", key)
                .param("membershipTypeId", membershipTypeId)
                .param("ruleType", type.name())
                .query(Integer.class)
                .optional();
    }
}
