package org.courtside.config.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class ClubConfigurationName implements ConfigurationSubjectNames {

    private final ClubConfigurationRepository configurations;

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        if (!subjectIds.contains(ClubConfiguration.SINGLETON_ID)) {
            return Map.of();
        }
        Map<UUID, String> names = new HashMap<>();
        configurations.findById(ClubConfiguration.SINGLETON_ID)
                .ifPresent(configuration -> names.put(ClubConfiguration.SINGLETON_ID, configuration.getClubName()));
        return names;
    }
}
