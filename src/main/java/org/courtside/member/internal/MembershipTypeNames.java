package org.courtside.member.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class MembershipTypeNames implements ConfigurationSubjectNames {

    private final MembershipTypeRepository membershipTypes;

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        Map<UUID, String> names = new HashMap<>();
        membershipTypes.findAllById(subjectIds)
                .forEach(type -> names.put(type.getId(), type.getName()));
        return names;
    }
}
