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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RosterSessionRowTest extends AbstractIntegrationTest {

    @Autowired
    private RosterService roster;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private FindByIndexNameSessionRepository<? extends Session> sessions;

    @Autowired
    private PlatformTransactionManager transactions;

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

    @Test
    void givenAnOperationThatIsRefusedAfterRevokingSessions_whenItRollsBack_thenTheRowStands() {
        // given — the session store commits on its own, so a deletion the operation does not
        // survive would sign a member out over a change that never happened
        UUID jane = accountHolder("doe.jane");
        storeSessionFor("doe.jane");

        // when / then
        assertThatThrownBy(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
            roster.resetPassword(jane, "another-one-time-password");
            throw new IllegalStateException("refused after the sessions were revoked");
        })).isInstanceOf(IllegalStateException.class);
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
