package org.courtside.facility.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.facility.AccessPoint;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class AccessPointNames implements ConfigurationSubjectNames {

    private final AccessPointRepository accessPoints;

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        Map<UUID, String> names = new HashMap<>();
        accessPoints.findAllById(subjectIds).forEach(point -> names.put(point.getId(), point.getName()));
        return names;
    }
}
