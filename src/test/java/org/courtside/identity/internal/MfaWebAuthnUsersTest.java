package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

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
