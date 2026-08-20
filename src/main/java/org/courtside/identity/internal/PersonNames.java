package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.shared.ConfigurationSubjectNames;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class PersonNames implements ConfigurationSubjectNames {

    private final PersonRepository persons;

    @Override
    public Map<UUID, String> namesFor(Collection<UUID> subjectIds) {
        return persons.findAllById(subjectIds).stream()
                .collect(Collectors.toMap(Person::getId, Person::getDisplayName));
    }
}
