package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Clock;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MfaFreshActorTest extends AbstractIntegrationTest {
    @Autowired private MfaManagement management;
    @Autowired private PermanentPasswordService permanentPasswords;
    @Autowired private MfaTotpRepository totp;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;
    @Autowired private PlatformTransactionManager transactions;

    enum Action { TOTP_SETUP, PASSWORD_CHANGE }

    @ParameterizedTest
    @EnumSource(Action.class)
    void givenAnAccountCachedBeforeRevocation_whenChangingSecurity_thenFreshLockedStateRejectsItsOldPrincipal(Action action) {
        // given
        Person jane = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = new UserAccount(jane, "doe.jane", passwords.encode("correct-horse"), Set.of(Role.MEMBER), "en");
        account.enable();
        accounts.save(account);
        byte[] secret = totp.begin(account.getId());
        assertThat(totp.confirm(account.getId(), TotpCodes.code(secret, clock.instant().minusSeconds(30)))).isTrue();
        var principal = new CourtsideUserDetails(account.getId(), account.getUsername(), "unused", true, true,
                List.of("ROLE_MEMBER"), account.getSecurityEpoch());
        var security = SecurityContextHolder.createEmptyContext();
        security.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities()));
        var request = new MockHttpServletRequest();
        request.getSession().setAttribute("courtside.authenticated-at", clock.instant().toEpochMilli());
        var previous = RequestContextHolder.getRequestAttributes();
        SecurityContextHolder.setContext(security);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        Class<? extends RuntimeException> refusal = action == Action.TOTP_SETUP
                ? MfaProofFailedException.class : ReauthenticationFailedException.class;
        // when / then
        try {
            assertThatThrownBy(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
                accounts.findById(account.getId()).orElseThrow();
                jdbc.sql("UPDATE user_account SET security_epoch = security_epoch + 1 WHERE id = :id")
                        .param("id", account.getId()).update();
                if (action == Action.TOTP_SETUP) management.beginTotp();
                else permanentPasswords.change("correct-horse", "durable-pine-forest-2026");
            })).isInstanceOf(refusal);
            assertThat(passwords.matches("correct-horse", accounts.findById(account.getId()).orElseThrow().getPasswordHash()))
                    .isTrue();
        } finally {
            SecurityContextHolder.clearContext();
            RequestContextHolder.setRequestAttributes(previous);
        }
    }
}
