package org.courtside.config;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.List;
import java.util.UUID;

@NullMarked
public sealed interface ConfigEvent extends DomainEventRecord {

    UUID configId();

    @Override
    default UUID subjectId() {
        return configId();
    }

    record ClubChanged(UUID configId, List<String> changedFields) implements ConfigEvent {

        static final String TYPE = "config.club.changed";

        public ClubChanged {
            changedFields = List.copyOf(changedFields);
        }

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record LocaleChanged(UUID configId, String defaultLocale) implements ConfigEvent {

        static final String TYPE = "config.club.localeChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record SlotDurationChanged(UUID configId, int slotMinutes) implements ConfigEvent {

        static final String TYPE = "config.club.slotDurationChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

    }

    record TimeZoneChanged(UUID configId, String timeZone) implements ConfigEvent {

        static final String TYPE = "config.club.timeZoneChanged";

        @Override
        public String eventType() {
            return TYPE;
        }

    }
}
