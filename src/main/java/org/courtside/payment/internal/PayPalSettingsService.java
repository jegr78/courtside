package org.courtside.payment.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.InstanceSecrets;
import org.courtside.identity.RecentAuthentication;
import org.courtside.payment.PayPalEnvironment;
import org.courtside.payment.PaymentEvent;
import org.jspecify.annotations.Nullable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class PayPalSettingsService {

    public static final int MAX_CLIENT_ID_LENGTH = 200;
    public static final int MAX_SECRET_LENGTH = 500;

    private final JdbcClient jdbc;
    private final InstanceSecrets secrets;
    private final PayPalCredentials credentials;
    private final PayPalCheckout checkout;
    private final TransactionTemplate transactions;
    private final PayPalConnectionCheck connection;
    private final RecentAuthentication recentAuthentication;
    private final CurrentUser currentUser;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    @Transactional(readOnly = true)
    public Settings settings() {
        return stored(false).map(row -> new Settings(row.clientId(), row.environment(), row.enabled(),
                row.secretStoredAt())).orElse(Settings.NONE);
    }

    /** Stores the settings; open orders of credentials that stop being active are settled or voided afterwards. */
    public Settings save(String clientId, PayPalEnvironment environment, boolean enabled, @Nullable String secret) {
        recentAuthentication.requireRecent();
        @Nullable UUID actor = currentUser.accountId().orElse(null);
        Saved saved = transactions.execute(status -> write(clientId, environment, enabled, secret, actor));
        saved.retired().ifPresent(this::retire);
        return saved.settings();
    }

    private Saved write(String clientId, PayPalEnvironment environment, boolean enabled, @Nullable String secret,
                        @Nullable UUID actor) {
        String client = clientId == null ? "" : clientId.strip();
        if (client.isEmpty() || client.length() > MAX_CLIENT_ID_LENGTH || environment == null) {
            throw new IllegalStateException("A client id of at most " + MAX_CLIENT_ID_LENGTH
                    + " characters and an environment are required");
        }
        if (secret != null && (secret.isBlank() || secret.length() > MAX_SECRET_LENGTH)) {
            throw new IllegalStateException("A PayPal secret holds 1 to " + MAX_SECRET_LENGTH + " characters");
        }
        Instant now = clock.instant();
        Optional<Row> current = stored(true);
        if (current.isEmpty()) {
            if (enabled && secret == null) throw new PayPalSecretRequiredException();
            UUID id = UUID.randomUUID();
            int created = jdbc.sql("""
                            INSERT INTO paypal_settings (id, client_id, secret_ciphertext, secret_stored_at, environment,
                                                         enabled, updated_at, updated_by)
                            VALUES (:id, :client, CAST(:secret AS text), CAST(:storedAt AS timestamptz), :environment,
                                    :enabled, :now, :actor)
                            ON CONFLICT (singleton) DO NOTHING
                            """)
                    .param("id", id).param("client", client)
                    .param("secret", secret == null ? null : encrypted(secret))
                    .param("storedAt", secret == null ? null : Timestamp.from(now))
                    .param("now", Timestamp.from(now)).param("environment", environment.name())
                    .param("enabled", enabled).param("actor", actor).update();
            if (created == 1) {
                events.publishEvent(new PaymentEvent.PayPalSettingsChanged(id, environment, enabled, true,
                        secret != null));
                return new Saved(new Settings(client, environment, enabled, secret == null ? null : now),
                        Optional.empty());
            }
            current = stored(true);
        }
        Row row = current.orElseThrow(() -> new IllegalStateException("The PayPal settings vanished during a save"));
        boolean credentialsMoved = !row.clientId().equals(client) || row.environment() != environment;
        boolean secretStored = row.secretStoredAt() != null;
        if (secret == null && (enabled && !secretStored || credentialsMoved && secretStored)) {
            throw new PayPalSecretRequiredException();
        }
        @Nullable Instant storedAt = secret == null ? row.secretStoredAt() : now;
        Optional<PayPalClient.Credentials> retired = credentialsMoved || row.enabled() && !enabled
                ? credentials.stored() : Optional.empty();
        jdbc.sql("""
                        UPDATE paypal_settings
                        SET client_id = :client, secret_ciphertext = coalesce(CAST(:secret AS text), secret_ciphertext),
                            secret_stored_at = CAST(:storedAt AS timestamptz), environment = :environment, enabled = :enabled,
                            updated_at = :now, updated_by = :actor
                        WHERE id = :id
                        """)
                .param("id", row.id()).param("client", client)
                .param("secret", secret == null ? null : encrypted(secret))
                .param("storedAt", storedAt == null ? null : Timestamp.from(storedAt))
                .param("environment", environment.name())
                .param("enabled", enabled).param("now", Timestamp.from(now)).param("actor", actor).update();
        events.publishEvent(new PaymentEvent.PayPalSettingsChanged(row.id(), environment, enabled,
                !row.clientId().equals(client), secret != null));
        return new Saved(new Settings(client, environment, enabled, storedAt), retired);
    }

    /** Deletes the settings; open orders of the removed credentials are settled or voided afterwards. */
    public void remove() {
        recentAuthentication.requireRecent();
        Optional<PayPalClient.Credentials> retired = transactions.execute(status -> {
            Optional<PayPalClient.Credentials> removed = credentials.stored();
            jdbc.sql("DELETE FROM paypal_settings RETURNING id").query(UUID.class).optional()
                    .ifPresent(id -> events.publishEvent(new PaymentEvent.PayPalCredentialsRemoved(id)));
            return removed;
        });
        retired.ifPresent(this::retire);
    }

    private void retire(PayPalClient.Credentials former) {
        try {
            checkout.retire(former);
        } catch (RuntimeException failed) {
            log.error("Open PayPal orders of the former {} credentials stay open for the reconciliation",
                    former.environment(), failed);
        }
    }

    public PayPalConnectionCheck.Result check() {
        Optional<PayPalClient.Credentials> stored = credentials.stored();
        if (stored.isEmpty()) return new PayPalConnectionCheck.Result(PayPalConnectionCheck.Outcome.NOT_CONFIGURED,
                null);
        PayPalClient.Credentials credentials = stored.get();
        return connection.check(credentials.environment(), credentials.clientId(), credentials.secret());
    }

    private String encrypted(String secret) {
        return secrets.encrypt(PayPalStoredSecret.PURPOSE, secret.getBytes(StandardCharsets.UTF_8));
    }

    private Optional<Row> stored(boolean forUpdate) {
        return jdbc.sql("""
                        SELECT id, client_id, environment, enabled, secret_stored_at FROM paypal_settings
                        """ + (forUpdate ? " FOR UPDATE" : ""))
                .query((rs, n) -> new Row(rs.getObject(1, UUID.class), rs.getString(2),
                        PayPalEnvironment.valueOf(rs.getString(3)), rs.getBoolean(4),
                        rs.getTimestamp(5) == null ? null : rs.getTimestamp(5).toInstant()))
                .optional();
    }

    public record Settings(@Nullable String clientId, PayPalEnvironment environment, boolean enabled,
                           @Nullable Instant secretStoredAt) {
        static final Settings NONE = new Settings(null, PayPalEnvironment.SANDBOX, false, null);
    }

    private record Saved(Settings settings, Optional<PayPalClient.Credentials> retired) {
    }

    private record Row(UUID id, String clientId, PayPalEnvironment environment, boolean enabled,
                       @Nullable Instant secretStoredAt) {
    }
}
