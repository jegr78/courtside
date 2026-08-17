package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class RosterSessionRowTest extends AbstractIntegrationTest {

    @Autowired
    private RosterService roster;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private FindByIndexNameSessionRepository<? extends Session> sessions;

    @Test
    void givenAStoredSession_whenThePasswordIsReset_thenTheRowIsGoneAndNotLeftToExpire() {
        // given
        UUID jane = accountHolder("doe.jane");
        storeSessionFor("doe.jane");

        // when
        roster.resetPassword(jane, "another-one-time-password");

        // then
        assertThat(sessions.findByPrincipalName("doe.jane")).isEmpty();
    }

    @Test
    void givenAStoredSession_whenTheUsernameIsCorrected_thenTheRowUnderTheOldNameIsGone() {
        // given — the index carries the name the session signed in with, so a deletion looking
        // for the new one would find nothing and leave the row behind
        UUID jane = accountHolder("doe.jaen");
        storeSessionFor("doe.jaen");

        // when
        roster.changeUsername(jane, "doe.jane");

        // then
        assertThat(sessions.findByPrincipalName("doe.jaen")).isEmpty();
    }

    @Test
    void givenAStoredSession_whenTheUsernameItAlreadyHoldsIsWritten_thenTheRowStands() {
        // given
        UUID jane = accountHolder("doe.jane");
        storeSessionFor("doe.jane");

        // when
        roster.changeUsername(jane, "doe.jane");

        // then
        assertThat(sessions.findByPrincipalName("doe.jane")).hasSize(1);
    }

    private UUID accountHolder(String username) {
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        roster.createAccount(jane.getId(), username, "one-time-password", Set.of(Role.MEMBER));
        return jane.getId();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void storeSessionFor(String username) {
        SessionRepository repository = (SessionRepository) sessions;
        Session session = repository.createSession();
        session.setAttribute(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, username);
        repository.save(session);
        assertThat(sessions.findByPrincipalName(username)).hasSize(1);
    }
}
