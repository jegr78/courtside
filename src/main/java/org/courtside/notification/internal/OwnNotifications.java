package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.notification.MessageKind;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingDisplaced;
import org.courtside.shared.CursorPage;
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
import java.util.Optional;
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
    public CursorPage.Result<Entry> page(UUID cursor, int limit) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new IllegalStateException("Notification page size must be between 1 and " + MAX_PAGE_SIZE);
        }
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
                .param("accountId", accountId())
                .param("cursor", cursor)
                .param("probe", limit + 1)
                .query((rows, number) -> new Stored(rows.getObject("id", UUID.class),
                        MessageKind.valueOf(rows.getString("kind")),
                        json.readValue(rows.getString("parameters"), PARAMETERS),
                        rows.getTimestamp("created_at").toInstant(),
                        instant(rows.getTimestamp("read_at"))))
                .list();
        List<Entry> items = stored.stream().limit(limit).map(this::entry).toList();
        UUID next = stored.size() > limit ? items.getLast().id() : null;
        return new CursorPage.Result<>(items, next);
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

    private Entry entry(Stored stored) {
        Optional<BookingAnnouncement> booking = bookingOf(stored.parameters().get(QueuedMessage.BOOKING));
        UUID linkedBooking = booking.isPresent() ? UUID.fromString(stored.parameters().get(QueuedMessage.BOOKING)) : null;
        return new Entry(stored.id(), stored.kind(), stored.createdAt(), stored.readAt(), booking.orElse(null),
                closureOf(stored.parameters().get(QueuedMessage.CLOSURE)), targetOf(stored.kind()), linkedBooking);
    }

    private Optional<BookingAnnouncement> bookingOf(String bookingId) {
        if (bookingId == null) {
            return Optional.empty();
        }
        try {
            return bookings.describe(UUID.fromString(bookingId));
        } catch (IllegalArgumentException malformed) {
            return Optional.empty();
        }
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
    }

    public enum Target {
        BOOKINGS,
        ACCOUNT_SECURITY
    }

    public record Entry(UUID id, MessageKind kind, Instant createdAt, Instant readAt, BookingAnnouncement booking,
                        BookingDisplaced.Closure closure, Target target, UUID linkedBookingId) {
    }
}
