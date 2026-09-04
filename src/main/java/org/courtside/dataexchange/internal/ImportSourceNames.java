package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class ImportSourceNames implements ConfigurationSubjectNames {

    private final ImportSourceRepository sources;

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        Map<UUID, String> names = new HashMap<>();
        sources.findAllById(subjectIds)
                .forEach(source -> names.put(source.getId(), source.getDisplayName()));
        return names;
    }
}
