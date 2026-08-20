package org.courtside.rules;

import org.courtside.rules.internal.RuleType;
import org.courtside.shared.DomainEventRecord;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public sealed interface RulesEvent extends DomainEventRecord {

    UUID ruleSetId();

    @Override
    default UUID subjectId() {
        return ruleSetId();
    }

    record RuleSetAdded(UUID ruleSetId) implements RulesEvent {

        static final String TYPE = "rules.ruleSet.added";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record RuleSetChanged(UUID ruleSetId, List<String> changedFields) implements RulesEvent {

        static final String TYPE = "rules.ruleSet.changed";

        public RuleSetChanged {
            changedFields = List.copyOf(changedFields);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record RuleSetAvailabilityChanged(UUID ruleSetId, boolean active) implements RulesEvent {

        static final String TYPE = "rules.ruleSet.availabilityChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record RuleDefinitionSet(UUID ruleSetId, RuleType ruleType, Map<String, Integer> params)
            implements RulesEvent {

        static final String TYPE = "rules.definition.set";

        public RuleDefinitionSet {
            params = Map.copyOf(params);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record RuleDefinitionRemoved(UUID ruleSetId, RuleType ruleType) implements RulesEvent {

        static final String TYPE = "rules.definition.removed";

        @Override
        public String eventType() {
            return TYPE;
        }

    }
}
