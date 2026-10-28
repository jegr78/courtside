package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.ImmutablePublicKeyCredentialUserEntity;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MfaWebAuthnUsersTest extends AbstractIntegrationTest {
    @Autowired private MfaWebAuthnUsers users;
    @Autowired private JdbcClient jdbc;

    @Test
    void givenAnAccount_whenCreatingItsWebAuthnIdentity_thenTheStableHandleMapsBackToItsCurrentName() {
        // given
        UUID account = account("doe.jane");
        // when
        var user = users.ensure(account);
        // then
        assertThat(user).isNotNull();
        assertThat(user.getId().getBytes()).hasSize(16);
        assertThat(users.ensure(account).getId()).isEqualTo(user.getId());
        assertThat(users.findByUsername("doe.jane").getId()).isEqualTo(user.getId());
        assertThat(users.findById(user.getId()).getDisplayName()).isEqualTo("Jane Doe");
    }

    @Test
    void givenARenamedAccountAndAReusedUsername_whenLookingUpWebAuthnHandles_thenTheSecondHolderCannotInheritTheFirstHandles() {
        // given
        UUID previous = account("doe.jane");
        var original = users.ensure(previous);
        assertThat(original).isNotNull();
        jdbc.sql("UPDATE user_account SET username = 'renamed.jane' WHERE id = :id").param("id", previous).update();
        UUID replacement = account("doe.jane");
        // when / then
        assertThat(users.findByUsername("doe.jane")).isNull();
        assertThat(users.findByUsername("renamed.jane").getId()).isEqualTo(original.getId());
        assertThat(users.ensure(replacement).getId()).isNotEqualTo(original.getId());
        assertThat(users.findById(original.getId()).getName()).isEqualTo("renamed.jane");
    }

    @Test
    void givenAWebAuthnIdentity_whenDeletingIt_thenTheBusinessAccountRemains() {
        // given
        UUID account = account("doe.jane");
        var user = users.ensure(account);
        assertThat(user).isNotNull();
        // when
        users.delete(user.getId());
        // then
        assertThat(users.findById(user.getId())).isNull();
        assertThat(jdbc.sql("SELECT count(*) FROM user_account WHERE id = :id")
                .param("id", account).query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void givenMissingOrMalformedHandles_whenResolvingOrDeleting_thenNoAccountIdentityIsExposedOrRemoved() {
        // given
        UUID account = account("doe.jane");
        var original = users.ensure(account);
        // when / then
        for (Bytes invalid : new Bytes[]{null, new Bytes(new byte[15]), new Bytes(new byte[17])}) {
            assertThat(MfaWebAuthnUsers.account(invalid)).isEmpty();
            assertThat(users.findById(invalid)).isNull();
            users.delete(invalid);
        }
        for (String invalid : new String[]{null, "", " ", "missing.account"}) {
            assertThat(users.findByUsername(invalid)).isNull();
        }
        assertThat(users.findById(MfaWebAuthnUsers.handle(UUID.randomUUID()))).isNull();
        assertThat(users.findById(original.getId()).getName()).isEqualTo("doe.jane");
    }

    @Test
    void givenMissingAccountsOrInvalidIdentities_whenSaving_thenNoWebAuthnIdentityIsCreated() {
        // given
        var malformed = ImmutablePublicKeyCredentialUserEntity.builder().id(new Bytes(new byte[15]))
                .name("doe.jane").displayName("Jane Doe").build();
        // when / then
        assertThatThrownBy(() -> users.ensure(null)).isInstanceOf(InvalidDataAccessApiUsageException.class)
                .hasCauseInstanceOf(IllegalStateException.class)
                .hasMessage("WebAuthn account is missing");
        assertThatThrownBy(() -> users.ensure(UUID.randomUUID())).isInstanceOf(InvalidDataAccessApiUsageException.class)
                .hasCauseInstanceOf(IllegalStateException.class)
                .hasMessage("WebAuthn account is missing");
        assertThatThrownBy(() -> users.save(null)).isInstanceOf(InvalidDataAccessApiUsageException.class)
                .hasCauseInstanceOf(IllegalStateException.class)
                .hasMessage("WebAuthn account identity is required");
        assertThatThrownBy(() -> users.save(malformed)).isInstanceOf(InvalidDataAccessApiUsageException.class)
                .hasCauseInstanceOf(IllegalStateException.class)
                .hasMessage("Invalid WebAuthn account handle");
        assertThat(jdbc.sql("SELECT count(*) FROM user_entities").query(Long.class).single()).isZero();
    }

    @Test
    void givenAnIdentityWhoseStoredOwnerDiffersFromItsHandle_whenSaving_thenTheBindingCannotBeReassigned() {
        // given
        UUID first = account("doe.jane");
        UUID second = account("roe.john");
        var original = users.ensure(first);
        jdbc.sql("UPDATE user_entities SET account_id = :owner WHERE id = :id")
                .param("owner", second).param("id", original.getId().toBase64UrlString()).update();
        // when / then
        assertThat(users.findById(original.getId())).isNull();
        assertThatThrownBy(() -> users.save(original)).isInstanceOf(InvalidDataAccessApiUsageException.class)
                .hasCauseInstanceOf(IllegalStateException.class)
                .hasMessage("WebAuthn account binding cannot be changed");
        assertThat(jdbc.sql("SELECT account_id FROM user_entities WHERE id = :id")
                .param("id", original.getId().toBase64UrlString()).query(UUID.class).single()).isEqualTo(second);
    }

    private UUID account(String username) {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO person (id, first_name, last_name, email) VALUES (:id, 'Jane', 'Doe', :email)")
                .param("id", id).param("email", id + "@example.org").update();
        jdbc.sql("""
                INSERT INTO user_account (id, person_id, username, locale, enabled, password_change_required)
                VALUES (:id, :id, :username, 'en', true, false)
                """).param("id", id).param("username", username).update();
        return id;
    }
}
