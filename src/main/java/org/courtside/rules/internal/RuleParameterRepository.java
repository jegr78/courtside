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

    // Both questions ask the same rule set: the one a person's membership type names, or the one
    // the club named for holding none. A membership type naming no rule set keeps naming none.
    public Optional<Integer> findIntParameter(UUID membershipTypeId, RuleType type, String key) {
        if (membershipTypeId == null) {
            return withoutAMembershipType.ruleSetId()
                    .flatMap(ruleSetId -> parameterInRuleSet(ruleSetId, type, key));
        }
        return parameterInMembershipType(membershipTypeId, type, key);
    }

    public boolean carriesRule(UUID membershipTypeId, RuleType type) {
        if (membershipTypeId == null) {
            return withoutAMembershipType.ruleSetId()
                    .filter(ruleSetId -> ruleSetCarries(ruleSetId, type))
                    .isPresent();
        }
        return membershipTypeCarries(membershipTypeId, type);
    }

    private Optional<Integer> parameterInMembershipType(UUID membershipTypeId, RuleType type, String key) {
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

    private Optional<Integer> parameterInRuleSet(UUID ruleSetId, RuleType type, String key) {
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

    private boolean membershipTypeCarries(UUID membershipTypeId, RuleType type) {
        return jdbc.sql("""
                        SELECT count(*) > 0
                        FROM membership_type mt
                        JOIN rule_definition rd ON rd.rule_set_id = mt.rule_set_id
                        WHERE mt.id = :membershipTypeId
                          AND rd.rule_type = :ruleType
                        """)
                .param("membershipTypeId", membershipTypeId)
                .param("ruleType", type.name())
                .query(Boolean.class)
                .single();
    }

    private boolean ruleSetCarries(UUID ruleSetId, RuleType type) {
        return jdbc.sql("""
                        SELECT count(*) > 0
                        FROM rule_definition rd
                        WHERE rd.rule_set_id = :ruleSetId
                          AND rd.rule_type = :ruleType
                        """)
                .param("ruleSetId", ruleSetId)
                .param("ruleType", type.name())
                .query(Boolean.class)
                .single();
    }
}
