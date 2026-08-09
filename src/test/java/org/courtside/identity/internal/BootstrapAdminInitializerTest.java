package org.courtside.identity.internal;

import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BootstrapAdminInitializerTest {

    @Mock private BootstrapLock lock;
    @Mock private PersonRepository persons;
    @Mock private UserAccountRepository accounts;
    @Mock private PasswordEncoder encoder;

    @Test
    void givenAnEmptyAccountTable_whenInitializing_thenOneEnabledLocalAdminIsCreated() {
        // given
        when(accounts.count()).thenReturn(0L);
        when(accounts.existsByUsername("local-admin")).thenReturn(false);
        when(encoder.encode("temporary-password")).thenReturn("encoded");
        when(persons.save(any(Person.class))).thenAnswer(invocation -> invocation.getArgument(0));
        BootstrapAdminInitializer initializer = initializer(new BootstrapAdminProperties(
                "local-admin", "temporary-password", "Ada Admin"));

        // when
        initializer.run(null);

        // then
        ArgumentCaptor<UserAccount> created = ArgumentCaptor.forClass(UserAccount.class);
        verify(accounts).save(created.capture());
        UserAccount account = created.getValue();
        assertThat(account.getUsername()).isEqualTo("local-admin");
        assertThat(account.getPerson().getDisplayName()).isEqualTo("Ada Admin");
        assertThat(account.getRoles()).containsExactly(Role.ADMIN);
        assertThat(account).extracting(UserAccount::isEnabled,
                UserAccount::isPasswordChangeRequired).containsExactly(true, true);
    }

    @Test
    void givenAnEmptyAccountTableAndNoBootstrapValues_whenInitializing_thenStartupFailsClosed() {
        // given
        when(accounts.count()).thenReturn(0L);
        BootstrapAdminInitializer initializer = initializer(
                new BootstrapAdminProperties("", "", ""));

        // when / then
        assertThatThrownBy(() -> initializer.run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_BOOTSTRAP_ADMIN_USERNAME");
        verify(persons, never()).save(any());
        verify(accounts, never()).save(any());
    }

    @Test
    void givenAnExistingAccount_whenInitializing_thenBootstrapValuesAreIgnored() {
        // given
        when(accounts.count()).thenReturn(1L);
        BootstrapAdminInitializer initializer = initializer(
                new BootstrapAdminProperties("", "", ""));

        // when
        initializer.run(null);

        // then
        verify(persons, never()).save(any());
        verify(accounts, never()).save(any());
        verify(encoder, never()).encode(any());
    }

    private BootstrapAdminInitializer initializer(BootstrapAdminProperties properties) {
        return new BootstrapAdminInitializer(lock, persons, accounts, encoder, properties);
    }
}
