package org.courtside.audit.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AuditService {

    private final DomainEventRepository events;
    private final UserAccountRepository accounts;
    private final List<ConfigurationSubjectNames> subjectNames;

    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        if (subjectIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> resolved = new HashMap<>();
        subjectNames.forEach(source -> resolved.putAll(source.namesFor(subjectIds)));
        return Map.copyOf(resolved);
    }
}
