package org.courtside.member;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
@RequiredArgsConstructor
class RuleSetActivationRepository {

    private final JdbcClient jdbc;

    boolean isInactive(UUID ruleSetId) {
        return jdbc.sql("SELECT active FROM rule_set WHERE id = :id")
                .param("id", ruleSetId)
                .query(Boolean.class)
                .optional()
                .filter(active -> !active)
                .isPresent();
    }
}
