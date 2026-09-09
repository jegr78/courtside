package org.courtside.shared;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecurityEventLogTest {

    private static final UUID ACCOUNT = UUID.fromString("00000000-0000-0000-0000-000000000101");
    private static final UUID ACTOR = UUID.fromString("00000000-0000-0000-0000-000000000102");

    private final ListAppender<ILoggingEvent> recorded = new ListAppender<>();
    private final SecurityEventLog events = new SecurityEventLog();

    @BeforeEach
    void attachAppender() {
        recorded.start();
        eventLogger().addAppender(recorded);
    }

    @AfterEach
    void detachAppender() {
        TransactionSynchronizationManager.clear();
        SecurityContextHolder.clearContext();
        eventLogger().detachAppender(recorded);
        recorded.stop();
    }

    @Test
    void givenTheShippedCatalogue_whenLoaded_thenItExactlyMatchesTheRuntimeContract() throws Exception {
        // given
        Catalogue catalogue;
        try (InputStream source = getClass().getResourceAsStream("/security/security-events.json")) {
            catalogue = new ObjectMapper().readValue(source, Catalogue.class);
        }

        // when
        List<CatalogueEvent> runtime = SecurityEvent.definitions().stream()
                .map(event -> new CatalogueEvent(event.code(), event.level().toString(), event.outcome(),
                        event.allowedFields().stream().sorted().toList(), event.allowedValues()))
                .toList();

        // then
        assertThat(catalogue.version()).isEqualTo(1);
        assertThat(catalogue.events()).containsExactlyElementsOf(runtime);
        assertThat(catalogue.events()).extracting(CatalogueEvent::code).doesNotHaveDuplicates();
    }

    @Test
    void givenEverySupportedSecurityEvent_whenEmitted_thenItsFieldsAndSeverityMatchTheCatalogue() {
        // when
        events.authenticationSucceeded(ACCOUNT);
        events.authenticationFailed(ACCOUNT, SecurityEventLog.AuthenticationFailure.BAD_CREDENTIALS);
        events.authorizationDenied(ACCOUNT);
        events.sessionTerminated(ACCOUNT, ACTOR, SecurityEventLog.SessionTermination.EXPLICIT_LOGOUT);
        events.credentialChanged(ACCOUNT, ACTOR, SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);
        events.administrativeAction(ACCOUNT, ACTOR, SecurityEventLog.AdministrativeAction.ROLES_CHANGED);
        events.controlTriggered(ACCOUNT, SecurityEventLog.ControlTrigger.LOGIN_ADDRESS_LIMIT);
        events.controlRefused(ACCOUNT, SecurityEventLog.ControlRefusal.CSRF);

        // then
        assertEvent(0, SecurityEvent.AUTHENTICATION_SUCCEEDED, Map.of("account.id", ACCOUNT.toString()));
        assertEvent(1, SecurityEvent.AUTHENTICATION_FAILED, Map.of(
                "account.id", ACCOUNT.toString(),
                "event.reason", "BAD_CREDENTIALS"));
        assertEvent(2, SecurityEvent.AUTHORIZATION_DENIED, Map.of("account.id", ACCOUNT.toString()));
        assertEvent(3, SecurityEvent.SESSION_TERMINATED, Map.of(
                "account.id", ACCOUNT.toString(),
                "actor.account.id", ACTOR.toString(),
                "event.reason", "EXPLICIT_LOGOUT"));
        assertEvent(4, SecurityEvent.CREDENTIAL_CHANGED, Map.of(
                "account.id", ACCOUNT.toString(),
                "actor.account.id", ACTOR.toString(),
                "event.action", "PERMANENT_PASSWORD_REPLACED"));
        assertEvent(5, SecurityEvent.ADMINISTRATIVE_SECURITY_ACTION, Map.of(
                "account.id", ACCOUNT.toString(),
                "actor.account.id", ACTOR.toString(),
                "event.action", "ROLES_CHANGED"));
        assertEvent(6, SecurityEvent.CONTROL_TRIGGERED, Map.of(
                "account.id", ACCOUNT.toString(),
                "event.reason", "LOGIN_ADDRESS_LIMIT"));
        assertEvent(7, SecurityEvent.CONTROL_REFUSED, Map.of(
                "account.id", ACCOUNT.toString(),
                "event.reason", "CSRF"));
    }

    @Test
    void givenAnUnknownLoginIdentifier_whenAuthenticationFails_thenNoSubmittedTextCanEnterTheEvent() {
        // given
        String submittedIdentifier = "unknown\n{\"event.code\":\"forged\"}";

        // when
        events.authenticationFailed(null, SecurityEventLog.AuthenticationFailure.BAD_CREDENTIALS);

        // then
        assertEvent(0, SecurityEvent.AUTHENTICATION_FAILED, Map.of("event.reason", "BAD_CREDENTIALS"));
        assertThat(recorded.list.getFirst().toString()).doesNotContain(submittedIdentifier, "forged");
    }

    @Test
    void givenACredentialTransaction_whenItCommits_thenSuccessIsOnlyRecordedAfterTheCommit() {
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);

        events.credentialChangedAfterCommit(
                ACCOUNT, ACTOR, SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);

        assertThat(recorded.list).isEmpty();
        TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);
        assertEvent(0, SecurityEvent.CREDENTIAL_CHANGED, Map.of(
                "account.id", ACCOUNT.toString(),
                "actor.account.id", ACTOR.toString(),
                "event.action", "PERMANENT_PASSWORD_REPLACED"));
    }

    @Test
    void givenACredentialTransaction_whenItRollsBack_thenNoSuccessIsRecorded() {
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);

        events.credentialChangedAfterCommit(
                ACCOUNT, ACTOR, SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED);
        TransactionSynchronizationManager.getSynchronizations()
                .forEach(callback -> callback.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));

        assertThat(recorded.list).isEmpty();
    }

    @Test
    void givenAnAuthenticatedActor_whenACredentialWithdrawalCommits_thenTheCapturedActorIsRecorded() {
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        SecurityEventPrincipal principal = () -> ACTOR;
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of()));

        events.credentialChangedAfterCommitForCurrentActor(
                ACCOUNT, SecurityEventLog.CredentialChange.TEMPORARY_CREDENTIAL_WITHDRAWN);
        SecurityContextHolder.clearContext();
        TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);

        assertEvent(0, SecurityEvent.CREDENTIAL_CHANGED, Map.of(
                "account.id", ACCOUNT.toString(),
                "actor.account.id", ACTOR.toString(),
                "event.action", "TEMPORARY_CREDENTIAL_WITHDRAWN"));
    }

    @Test
    void givenNoCredentialTransaction_whenSuccessWouldBeScheduled_thenTheProgrammingErrorIsRefused() {
        assertThatThrownBy(() -> events.credentialChangedAfterCommit(
                ACCOUNT, ACTOR, SecurityEventLog.CredentialChange.PERMANENT_PASSWORD_REPLACED))
                .isInstanceOf(IllegalStateException.class);

        assertThat(recorded.list).isEmpty();
    }

    private void assertEvent(int index, SecurityEvent expected, Map<String, Object> specificFields) {
        ILoggingEvent event = recorded.list.get(index);
        Map<String, Object> fields = new LinkedHashMap<>();
        event.getKeyValuePairs().forEach(pair -> fields.put(pair.key, pair.value));

        Map<String, Object> expectedFields = new LinkedHashMap<>();
        expectedFields.put("event.code", expected.code());
        expectedFields.put("event.outcome", expected.outcome());
        expectedFields.putAll(specificFields);

        assertThat(event.getLevel().toString()).isEqualTo(expected.level().name());
        assertThat(event.getFormattedMessage()).isEqualTo("Security event");
        assertThat(event.getInstant()).isNotNull();
        assertThat(event.getLoggerName()).isEqualTo("org.courtside.security.events");
        assertThat(event.getThreadName()).isNotBlank();
        assertThat(fields).containsExactlyInAnyOrderEntriesOf(expectedFields);
        assertThat(fields.keySet()).isSubsetOf(expected.allowedFields());
        assertThat(expected.allowedValues().keySet()).isSubsetOf(expected.allowedFields());
        expected.allowedValues().forEach((field, values) -> {
            if (fields.containsKey(field)) {
                assertThat(values).contains(fields.get(field).toString());
            }
        });
    }

    private static Logger eventLogger() {
        return (Logger) LoggerFactory.getLogger("org.courtside.security.events");
    }

    private record Catalogue(int version, List<CatalogueEvent> events) {
    }

    private record CatalogueEvent(String code, String severity, String result, List<String> allowedFields,
                                  Map<String, List<String>> allowedValues) {
    }
}
