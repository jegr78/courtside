package org.courtside.identity.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;

import java.util.Locale;
import java.util.UUID;

@RequiredArgsConstructor
public class IdentityTestFixture {

    private final PersonRepository persons;

    public UUID createPerson(String firstName, String lastName) {
        String email = (firstName + "." + lastName).toLowerCase(Locale.ROOT) + "@example.org";
        return persons.save(new Person(firstName, lastName, email)).getId();
    }

    public boolean personExists(UUID personId) {
        return persons.existsById(personId);
    }
}
