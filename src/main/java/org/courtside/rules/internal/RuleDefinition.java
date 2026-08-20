package org.courtside.rules.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.courtside.rules.RuleType;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "rule_definition")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RuleDefinition {

    @Id
    private UUID id;

    @Column(name = "rule_set_id", nullable = false)
    private UUID ruleSetId;

    @Enumerated(EnumType.STRING)
    @Column(name = "rule_type", nullable = false)
    private RuleType ruleType;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private Map<String, Integer> params;

    public RuleDefinition(UUID ruleSetId, RuleType ruleType, Map<String, Integer> params) {
        this.id = UUID.randomUUID();
        this.ruleSetId = ruleSetId;
        this.ruleType = ruleType;
        this.params = Map.copyOf(params);
    }

    public void changeTo(Map<String, Integer> params) {
        this.params = Map.copyOf(params);
    }
}
