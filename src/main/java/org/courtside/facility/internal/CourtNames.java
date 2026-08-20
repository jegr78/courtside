package org.courtside.facility.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.facility.Court;
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

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        Map<UUID, String> names = new HashMap<>();
        courts.findAllById(subjectIds).forEach(court -> names.put(court.getId(), nameOf(court)));
        return names;
    }

    private static String nameOf(Court court) {
        return court.getName() != null ? court.getName() : String.valueOf(court.getNumber());
    }
}
