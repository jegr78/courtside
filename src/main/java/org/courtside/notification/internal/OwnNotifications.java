package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.UserAccount;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingDisplaced;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class OwnNotifications {

    private static final int MAX_PAGE_SIZE = 100;
    private static final TypeReference<Map<String, String>> PARAMETERS = new TypeReference<>() {
    };

    private final CurrentUser currentUser;
    private final JdbcClient jdbc;
    private final BookingAnnouncer bookings;
    private final ObjectMapper json;
    private final Clock clock;

    // A cursor that is not one of this account's entries matches no sequence, so it reads as the end.
    @Transactional(readOnly = true)
    public Page page(UUID cursor, int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException("Notification page size must be between 1 and " + MAX_PAGE_SIZE);
        }
        UserAccount account = currentUser.requireAccount();
        List<Stored> stored = jdbc.sql("""
                        SELECT id, kind, parameters::text AS parameters, created_at, read_at
                        FROM notification
                        WHERE account_id = :accountId
                          AND (CAST(:cursor AS uuid) IS NULL OR created_seq < (
                              SELECT created_seq FROM notification
                              WHERE id = CAST(:cursor AS uuid) AND account_id = :accountId))
                        ORDER BY created_seq DESC
                        LIMIT :probe
                        """)
                .param("accountId", account.getId())
                .param("cursor", cursor)
                .param("probe", limit + 1)
                .query((rows, number) -> new Stored(rows.getObject("id", UUID.class),
                        MessageKind.valueOf(rows.getString("kind")),
                        json.readValue(rows.getString("parameters"), PARAMETERS),
                        rows.getTimestamp("created_at").toInstant(),
                        instant(rows.getTimestamp("read_at"))))
                .list();
        List<Stored> shown = stored.stream().limit(limit).toList();
        Map<UUID, BookingAnnouncement> visible = bookings.describeVisibleTo(account.getId(),
                account.getPerson().getId(), shown.stream().map(Stored::bookingId).filter(Objects::nonNull).toList());
        List<Entry> items = shown.stream().map(entry -> entry(entry, visible)).toList();
        UUID next = stored.size() > limit ? items.getLast().id() : null;
        return new Page(items, next, unread(account.getId()));
    }

    private long unread(UUID accountId) {
        return jdbc.sql("SELECT count(*) FROM notification WHERE account_id = :accountId AND read_at IS NULL")
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }

    @Transactional
    public void markRead(UUID notificationId) {
        int marked = jdbc.sql("""
                        UPDATE notification SET read_at = coalesce(read_at, :now)
                        WHERE id = :id AND account_id = :accountId
                        """)
                .param("now", Timestamp.from(clock.instant()))
                .param("id", notificationId)
                .param("accountId", accountId())
                .update();
        if (marked == 0) {
            throw new NotificationNotFoundException();
        }
    }

    // A booking the account may no longer see stays unnamed, so a player who left learns nothing more of it.
    private static Entry entry(Stored stored, Map<UUID, BookingAnnouncement> visible) {
        BookingAnnouncement booking = stored.bookingId() == null ? null : visible.get(stored.bookingId());
        return new Entry(stored.id(), stored.kind(), stored.createdAt(), stored.readAt(), booking,
                closureOf(stored.parameters().get(QueuedMessage.CLOSURE)), targetOf(stored.kind()),
                booking == null ? null : stored.bookingId());
    }

    private static BookingDisplaced.Closure closureOf(String stored) {
        return Arrays.stream(BookingDisplaced.Closure.values())
                .filter(closure -> closure.name().equals(stored))
                .findFirst()
                .orElse(null);
    }

    private static Target targetOf(MessageKind kind) {
        return switch (kind) {
            case CREDENTIALS_NEW_ACCOUNT, CREDENTIALS_PASSWORD_RESET, ACCOUNT_USERNAME_REMINDER,
                 ACCOUNT_PASSWORD_RESET_CODE -> Target.ACCOUNT_SECURITY;
            case BOOKING_CONFIRMED, BOOKING_PLAYER_RECORDED, BOOKING_PLAYER_WITHDREW, BOOKING_DISPLACED,
                 BOOKING_REMINDER -> Target.BOOKINGS;
        };
    }

    private UUID accountId() {
        return currentUser.requireAccount().getId();
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private record Stored(UUID id, MessageKind kind, Map<String, String> parameters, Instant createdAt,
                          Instant readAt) {

        UUID bookingId() {
            String stored = parameters.get(QueuedMessage.BOOKING);
            if (stored == null) {
                return null;
            }
            try {
                return UUID.fromString(stored);
            } catch (IllegalArgumentException malformed) {
                return null;
            }
        }
    }

    public enum Target {
        BOOKINGS,
        ACCOUNT_SECURITY
    }

    public record Page(List<Entry> items, UUID nextCursor, long unread) {

        public Page {
            items = List.copyOf(items);
        }
    }

    public record Entry(UUID id, MessageKind kind, Instant createdAt, Instant readAt, BookingAnnouncement booking,
                        BookingDisplaced.Closure closure, Target target, UUID linkedBookingId) {
    }
}
