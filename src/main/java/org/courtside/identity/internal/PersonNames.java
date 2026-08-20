package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class PersonNames implements ConfigurationSubjectNames {

    private final PersonRepository persons;

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        Map<UUID, String> names = new HashMap<>();
        persons.findAllById(subjectIds).forEach(person -> names.put(person.getId(), person.getDisplayName()));
        return names;
    }
}
