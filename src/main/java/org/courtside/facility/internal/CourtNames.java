package org.courtside.facility.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class CourtNames implements ConfigurationSubjectNames {

    private final CourtRepository courts;
    private final OpeningHoursRepository openingHours;

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        Map<UUID, String> names = new HashMap<>();
        courts.findAllById(subjectIds)
                .forEach(court -> names.put(court.getId(), court.getName()));
        openingHours.findAllById(subjectIds)
                .forEach(hours -> names.put(hours.getId(), hours.getDayOfWeek().name()));
        return names;
    }
}
