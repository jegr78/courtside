package org.courtside.identity.internal;

import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.web.webauthn.api.Bytes;
import org.springframework.security.web.webauthn.api.CredentialRecord;
import org.springframework.security.web.webauthn.api.ImmutableCredentialRecord;
import org.springframework.security.web.webauthn.management.UserCredentialRepository;
import org.springframework.security.web.webauthn.management.JdbcUserCredentialRepository;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

@Repository
class MfaWebAuthnCredentials implements UserCredentialRepository {
    private final JdbcUserCredentialRepository stored;
    private final JdbcClient jdbc;
    private final MfaWebAuthnUsers users;
    private final Clock clock;

    MfaWebAuthnCredentials(JdbcOperations sql, JdbcClient jdbc, MfaWebAuthnUsers users, Clock clock) {
        this.stored = new JdbcUserCredentialRepository(sql);
        this.jdbc = jdbc;
        this.users = users;
        this.clock = clock;
    }

    @Override
    @Transactional
    public void delete(Bytes id) {
        CredentialRecord initial = findByCredentialId(id);
        if (initial == null) return;
        lockAccount(initial.getUserEntityUserId());
        lockCredential(id);
        CredentialRecord current = findByCredentialId(id);
        if (current != null && current.getUserEntityUserId().equals(initial.getUserEntityUserId())) stored.delete(id);
    }

    @Override
    @Transactional
    public void save(CredentialRecord record) {
        if (record == null || record.getCredentialId() == null || record.getUserEntityUserId() == null) {
            throw new IllegalStateException("WebAuthn credential binding is required");
        }
        lockAccount(record.getUserEntityUserId());
        lockCredential(record.getCredentialId());
        CredentialRecord previous = stored.findByCredentialId(record.getCredentialId());
        if (previous != null && !previous.getUserEntityUserId().equals(record.getUserEntityUserId())) {
            throw new MfaProofFailedException();
        }
        if (users.findById(record.getUserEntityUserId()) == null) throw new MfaProofFailedException();
        var updated = ImmutableCredentialRecord.fromCredentialRecord(record);
        if (previous == null) updated.created(clock.instant()).lastUsed(clock.instant());
        else if (!record.getLastUsed().equals(previous.getLastUsed())) updated.lastUsed(clock.instant());
        stored.save(updated.build());
    }

    @Override
    @Transactional(readOnly = true)
    public CredentialRecord findByCredentialId(Bytes id) {
        return id == null ? null : stored.findByCredentialId(id);
    }

    @Override
    @Transactional(readOnly = true)
    public List<CredentialRecord> findByUserId(Bytes id) {
        return id == null ? List.of() : stored.findByUserId(id);
    }

    @Transactional(readOnly = true)
    boolean enabled(UUID account) {
        return jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM user_credentials credential
                    JOIN user_entities holder ON holder.id = credential.user_entity_user_id
                    WHERE holder.account_id = :account)
                """).param("account", account).query(Boolean.class).single();
    }

    @Transactional
    void deleteAll(UUID account) {
        if (account == null) throw new IllegalStateException("WebAuthn account is required");
        jdbc.sql("SELECT id FROM user_account WHERE id = :id FOR UPDATE")
                .param("id", account).query(UUID.class).single();
        jdbc.sql("""
                DELETE FROM user_credentials WHERE user_entity_user_id IN
                    (SELECT id FROM user_entities WHERE account_id = :account)
                """).param("account", account).update();
    }

    private void lockAccount(Bytes handle) {
        UUID account = MfaWebAuthnUsers.account(handle).orElseThrow(MfaProofFailedException::new);
        if (jdbc.sql("SELECT id FROM user_account WHERE id = :id FOR UPDATE")
                .param("id", account).query(UUID.class).optional().isEmpty()) throw new MfaProofFailedException();
    }

    private void lockCredential(Bytes id) {
        jdbc.sql("SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))) lock")
                .param("key", "mfa-webauthn-credential:" + id.toBase64UrlString()).query(Long.class).single();
    }
}
