package org.courtside.credit.internal;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubCurrency;
import org.courtside.credit.CreditEntryKind;
import org.courtside.credit.CreditEvent;
import org.courtside.identity.AccountAnonymisedException;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.jspecify.annotations.Nullable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class CreditLedger {

    public static final int MAX_AMOUNT_MINOR = 1_000_000;
    public static final int MAX_NOTE_LENGTH = 200;
    private static final int HOLDER_SEARCH_LIMIT = 20;

    private static final String ENTRIES = """
            SELECT e.id, e.position, e.kind, e.amount_minor, e.currency, e.recorded_at, n.reason_text,
                   sum(e.amount_minor) OVER (PARTITION BY e.currency ORDER BY e.position) AS balance_after
            FROM credit_entry e LEFT JOIN credit_entry_note n ON n.entry_id = e.id
            WHERE e.account_id = :account
            """;

    private final JdbcClient jdbc;
    private final EntityManager entities;
    private final ClubCurrency clubCurrency;
    private final CurrentUser currentUser;
    private final RecentAuthentication recentAuthentication;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    @Transactional
    public LedgerEntry record(UUID accountId, CreditEntryKind kind, int amountMinor, String note) {
        recentAuthentication.requireRecent();
        return append(accountId, kind, amountMinor, note);
    }

    @Transactional
    public LedgerEntry append(UUID accountId, CreditEntryKind kind, int amountMinor, String note) {
        if (accountId == null || kind == null) {
            throw new IllegalStateException("An account and a kind are required for a credit entry");
        }
        if (amountMinor < 1 || amountMinor > MAX_AMOUNT_MINOR) {
            throw new IllegalStateException("A credit entry amount must lie between 1 and " + MAX_AMOUNT_MINOR);
        }
        String reason = note == null ? "" : note.strip();
        if (reason.isEmpty() || reason.length() > MAX_NOTE_LENGTH) {
            throw new IllegalStateException("A credit entry needs a reason of at most " + MAX_NOTE_LENGTH + " characters");
        }
        UserAccount account = entities.find(UserAccount.class, accountId, LockModeType.PESSIMISTIC_READ);
        if (account == null) {
            throw new CreditAccountNotFoundException();
        }
        if (account.isAnonymised()) {
            throw new AccountAnonymisedException();
        }
        if (kind == CreditEntryKind.CREDIT && !account.getRoles().contains(Role.EXTERNAL)) {
            throw new CreditAccountNotExternalException();
        }
        lock(accountId);
        String currency = clubCurrency.currency().getCurrencyCode();
        long balance = balance(accountId, currency);
        int signed = kind == CreditEntryKind.CREDIT ? amountMinor : -amountMinor;
        if (balance + signed < 0) {
            throw new CreditInsufficientException(balance, currency);
        }
        UUID entryId = UUID.randomUUID();
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        jdbc.sql("""
                        INSERT INTO credit_entry (id, account_id, kind, amount_minor, currency, recorded_at, recorded_by)
                        VALUES (:id, :account, :kind, :amount, :currency, :at, :by)
                        """)
                .param("id", entryId)
                .param("account", accountId)
                .param("kind", kind.name())
                .param("amount", signed)
                .param("currency", currency)
                .param("at", Timestamp.from(now))
                .param("by", currentUser.accountId().orElse(null))
                .update();
        jdbc.sql("INSERT INTO credit_entry_note (entry_id, reason_text) VALUES (:id, :note)")
                .param("id", entryId).param("note", reason).update();
        events.publishEvent(new CreditEvent.EntryRecorded(accountId, entryId, kind, signed, currency));
        return new LedgerEntry(entryId, kind, signed, currency, balance + signed, now, reason);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public LedgerPage pageOfAccount(UUID accountId, @Nullable UUID cursor, int limit) {
        if (accountId == null || entities.find(UserAccount.class, accountId) == null) {
            throw new CreditAccountNotFoundException();
        }
        return page(accountId, cursor, limit);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public LedgerPage page(UUID accountId, @Nullable UUID cursor, int limit) {
        if (accountId == null || limit < 1) {
            throw new IllegalStateException("An account and a positive limit are required for a ledger page");
        }
        String currency = clubCurrency.currency().getCurrencyCode();
        String after = cursor == null ? "" : """
                WHERE t.position < (SELECT c.position FROM credit_entry c
                                    WHERE c.id = :cursor AND c.account_id = :account)
                """;
        var query = jdbc.sql("SELECT * FROM (" + ENTRIES + ") t " + after
                        + " ORDER BY t.position DESC LIMIT :limit")
                .param("account", accountId)
                .param("limit", Math.addExact(limit, 1));
        if (cursor != null) {
            query = query.param("cursor", cursor);
        }
        List<LedgerEntry> found = query.query(CreditLedger::entry).list();
        List<LedgerEntry> items = found.stream().limit(limit).toList();
        UUID next = found.size() > limit ? items.getLast().id() : null;
        return new LedgerPage(balance(accountId, currency), currency, items, next);
    }

    @Transactional(readOnly = true)
    public List<CreditHolder> holders(@Nullable String search) {
        String currency = clubCurrency.currency().getCurrencyCode();
        String fragment = search == null ? "" : search.strip().toLowerCase();
        String select = """
                SELECT u.id, p.first_name, p.last_name, p.email,
                       COALESCE((SELECT sum(e.amount_minor) FROM credit_entry e
                                 WHERE e.account_id = u.id AND e.currency = :currency), 0) AS balance
                FROM user_account u JOIN person p ON p.id = u.person_id
                WHERE u.anonymised_at IS NULL
                """;
        var query = fragment.isEmpty()
                ? jdbc.sql("SELECT * FROM (" + select + ") h WHERE h.balance <> 0"
                        + " ORDER BY lower(h.last_name), lower(h.first_name), h.id")
                : jdbc.sql(select + """
                          AND (EXISTS (SELECT 1 FROM user_account_role r
                                       WHERE r.user_account_id = u.id AND r.role = 'EXTERNAL')
                               OR EXISTS (SELECT 1 FROM credit_account a WHERE a.account_id = u.id))
                          AND (lower(concat(p.first_name, ' ', p.last_name)) LIKE concat('%', :fragment, '%') ESCAPE '!'
                               OR lower(p.email) LIKE concat('%', :fragment, '%') ESCAPE '!'
                               OR lower(u.username) LIKE concat('%', :fragment, '%') ESCAPE '!')
                        ORDER BY lower(p.last_name), lower(p.first_name), u.id
                        LIMIT :limit
                        """)
                .param("fragment", escaped(fragment))
                .param("limit", HOLDER_SEARCH_LIMIT);
        return query.param("currency", currency)
                .query((rs, row) -> new CreditHolder(rs.getObject("id", UUID.class), rs.getString("first_name"),
                        rs.getString("last_name"), rs.getString("email"), rs.getLong("balance"), currency))
                .list();
    }

    private void lock(UUID accountId) {
        // Shares the club configuration lock, so a currency change waits for this entry and then sees it.
        jdbc.sql("SELECT 1 FROM club_config FOR SHARE").query(Integer.class).list();
        jdbc.sql("INSERT INTO credit_account (account_id) VALUES (:account) ON CONFLICT DO NOTHING")
                .param("account", accountId).update();
        jdbc.sql("SELECT account_id FROM credit_account WHERE account_id = :account FOR UPDATE")
                .param("account", accountId).query(UUID.class).single();
    }

    private long balance(UUID accountId, String currency) {
        return jdbc.sql("""
                        SELECT COALESCE(sum(amount_minor), 0) FROM credit_entry
                        WHERE account_id = :account AND currency = :currency
                        """)
                .param("account", accountId).param("currency", currency).query(Long.class).single();
    }

    private static LedgerEntry entry(ResultSet rs, int row) throws SQLException {
        return new LedgerEntry(rs.getObject("id", UUID.class), CreditEntryKind.valueOf(rs.getString("kind")),
                rs.getInt("amount_minor"), rs.getString("currency"), rs.getLong("balance_after"),
                rs.getTimestamp("recorded_at").toInstant(), rs.getString("reason_text"));
    }

    private static String escaped(String value) {
        return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    public record LedgerEntry(UUID id, CreditEntryKind kind, int amountMinor, String currency, long balanceAfterMinor,
                        Instant recordedAt, @Nullable String note) {
    }

    public record LedgerPage(long balanceMinor, String currency, List<LedgerEntry> items, @Nullable UUID nextCursor) {

        public LedgerPage {
            items = List.copyOf(items);
        }
    }

    public record CreditHolder(UUID accountId, String firstName, String lastName, String email, long balanceMinor,
                         String currency) {
    }
}
