package org.courtside.rules.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.RuleSetForPeopleWithoutAMembershipType;
import org.courtside.rules.RuleType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
@RequiredArgsConstructor
public class RuleParameterRepository {

    private final JdbcClient jdbc;
    private final RuleSetForPeopleWithoutAMembershipType withoutAMembershipType;

    // A membership type that names no rule set keeps naming none: the club said this category is
    // measured by nothing, which is a different answer from holding no membership type at all.
    public Optional<Integer> findIntParameter(UUID membershipTypeId, RuleType type, String key) {
        if (membershipTypeId == null) {
            return withoutAMembershipType.ruleSetId()
                    .flatMap(ruleSetId -> findInRuleSet(ruleSetId, type, key));
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

    private Optional<Integer> findInRuleSet(UUID ruleSetId, RuleType type, String key) {
        return jdbc.sql("""
                        SELECT (rd.params ->> :key)::int
                        FROM rule_definition rd
                        WHERE rd.rule_set_id = :ruleSetId
                          AND rd.rule_type = :ruleType
                        """)
                .param("key", key)
                .param("ruleSetId", ruleSetId)
                .param("ruleType", type.name())
                .query(Integer.class)
                .optional();
    }
}
