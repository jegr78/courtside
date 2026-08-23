package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.SessionRepository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(IdentityTestFixture.class)
class RosterSessionRowTest extends AbstractIntegrationTest {

    @Autowired
    private RosterService roster;

    @Autowired
    private IdentityTestFixture identity;

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
        roster.requestCredentials(jane);

        // then
        assertThat(sessions.findByPrincipalName("doe.jane")).isEmpty();
    }

    @Test
    void givenAStoredSession_whenTheUsernameIsCorrected_thenTheRowUnderTheOldNameIsGone() {
        // given
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
        // given
        UUID jane = accountHolder("doe.jane");
        storeSessionFor("doe.jane");

        // when / then
        assertThatThrownBy(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
            roster.requestCredentials(jane);
            throw new IllegalStateException("refused after the sessions were revoked");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(sessions.findByPrincipalName("doe.jane")).hasSize(1);
    }

    private UUID accountHolder(String username) {
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(jane, username, Set.of(Role.MEMBER));
        return jane;
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
