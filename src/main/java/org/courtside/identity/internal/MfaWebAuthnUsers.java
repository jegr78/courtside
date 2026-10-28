package org.courtside.identity.internal;

import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.courtside.identity.UserAccountRepository;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.ImmutablePublicKeyCredentialUserEntity;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialUserEntity;
import org.springframework.security.web.webauthn.management.JdbcPublicKeyCredentialUserEntityRepository;
import org.springframework.security.web.webauthn.management.PublicKeyCredentialUserEntityRepository;

import java.util.UUID;
import java.util.Optional;
import java.nio.ByteBuffer;

@Repository
class MfaWebAuthnUsers implements PublicKeyCredentialUserEntityRepository {
    private final JdbcPublicKeyCredentialUserEntityRepository stored;
    private final JdbcClient jdbc;
    private final UserAccountRepository accounts;

    MfaWebAuthnUsers(JdbcOperations sql, JdbcClient jdbc, UserAccountRepository accounts) {
        this.stored = new JdbcPublicKeyCredentialUserEntityRepository(sql);
        this.jdbc = jdbc;
        this.accounts = accounts;
    }

    @Transactional
    PublicKeyCredentialUserEntity ensure(UUID account) {
        lock(account);
        Bytes handle = handle(account);
        PublicKeyCredentialUserEntity current = findById(handle);
        if (current != null) return current;
        save(ImmutablePublicKeyCredentialUserEntity.builder().id(handle)
                .name(account.toString()).displayName(account.toString()).build());
        return findById(handle);
    }

    @Override
    @Transactional(readOnly = true)
    public PublicKeyCredentialUserEntity findById(Bytes id) {
        Optional<UUID> owner = account(id);
        if (owner.isEmpty() || stored.findById(id) == null) return null;
        return jdbc.sql("SELECT account_id FROM user_entities WHERE id = :id AND account_id = :account")
                .param("id", id.toBase64UrlString()).param("account", owner.orElseThrow()).query(UUID.class).optional()
                .flatMap(accounts::findById)
                .map(account -> ImmutablePublicKeyCredentialUserEntity.builder().id(id).name(account.getUsername())
                        .displayName(account.getPerson().getDisplayName()).build()).orElse(null);
    }

    @Override
    @Transactional(readOnly = true)
    public PublicKeyCredentialUserEntity findByUsername(String username) {
        if (username == null || username.isBlank()) return null;
        return accounts.findByUsername(username).map(account -> findById(handle(account.getId()))).orElse(null);
    }

    @Override
    @Transactional
    public void save(PublicKeyCredentialUserEntity user) {
        if (user == null) throw new IllegalStateException("WebAuthn account identity is required");
        UUID owner = account(user.getId()).orElseThrow(() -> new IllegalStateException("Invalid WebAuthn account handle"));
        lock(owner);
        stored.save(ImmutablePublicKeyCredentialUserEntity.builder().id(user.getId())
                .name(owner.toString()).displayName(owner.toString()).build());
        if (jdbc.sql("""
                UPDATE user_entities SET account_id = :account WHERE id = :id
                    AND (account_id IS NULL OR account_id = :account)
                """).param("account", owner).param("id", user.getId().toBase64UrlString()).update() != 1) {
            throw new IllegalStateException("WebAuthn account binding cannot be changed");
        }
    }

    @Override
    @Transactional
    public void delete(Bytes id) {
        Optional<UUID> owner = account(id);
        if (owner.isEmpty()) return;
        lock(owner.orElseThrow());
        stored.delete(id);
    }

    private void lock(UUID account) {
        if (account == null || jdbc.sql("SELECT id FROM user_account WHERE id = :id FOR UPDATE")
                .param("id", account).query(UUID.class).optional().isEmpty()) {
            throw new IllegalStateException("WebAuthn account is missing");
        }
    }

    static Bytes handle(UUID account) {
        return new Bytes(ByteBuffer.allocate(16).putLong(account.getMostSignificantBits())
                .putLong(account.getLeastSignificantBits()).array());
    }

    static Optional<UUID> account(Bytes handle) {
        if (handle == null || handle.getBytes().length != 16) return Optional.empty();
        ByteBuffer bytes = ByteBuffer.wrap(handle.getBytes());
        return Optional.of(new UUID(bytes.getLong(), bytes.getLong()));
    }
}
