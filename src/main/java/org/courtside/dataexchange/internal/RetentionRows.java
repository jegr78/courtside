package org.courtside.dataexchange.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.dataexchange.RetentionCategory;
import org.courtside.dataexchange.RetentionPlan.BlockReason;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.sql.Array;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@NullMarked
@Component
@RequiredArgsConstructor
public class RetentionRows {

    private static final String BOOKING_END = """
            COALESCE((SELECT max(a.ends_at) FROM court_allocation a WHERE a.booking_id = b.id), b.created_at)""";

    private static final String DUE_BOOKINGS = "SELECT b.id FROM booking b WHERE b.pseudonymised_at IS NULL AND "
            + BOOKING_END + " < :endedBefore";

    // Covered means this run pseudonymises the booking anyway, so it no longer names the person.
    private static final String NOT_COVERED = "(CAST(:endedBefore AS timestamptz) IS NULL OR "
            + BOOKING_END + " >= CAST(:endedBefore AS timestamptz))";

    /** A change-log payload field that names a person or an account, matched case-insensitively. */
    public static final String PERSONAL_PAYLOAD_FIELD = "(person|account)id$";

    private final JdbcClient jdbc;

    public Map<RetentionCategory, Integer> policies() {
        Map<RetentionCategory, Integer> policies = new EnumMap<>(RetentionCategory.class);
        jdbc.sql("SELECT category, retain_months FROM retention_policy")
                .query(rs -> {
                    policies.put(RetentionCategory.valueOf(rs.getString("category")), rs.getInt("retain_months"));
                });
        return policies;
    }

    /** The configured periods, held against a change until the transaction ends. */
    public Map<RetentionCategory, Integer> lockPolicies() {
        Map<RetentionCategory, Integer> policies = new EnumMap<>(RetentionCategory.class);
        jdbc.sql("SELECT category, retain_months FROM retention_policy ORDER BY category FOR SHARE")
                .query(rs -> {
                    policies.put(RetentionCategory.valueOf(rs.getString("category")), rs.getInt("retain_months"));
                });
        return policies;
    }

    public void setPolicy(RetentionCategory category, int retainMonths) {
        jdbc.sql("""
                        INSERT INTO retention_policy (category, retain_months) VALUES (:category, :months)
                        ON CONFLICT (category) DO UPDATE SET retain_months = EXCLUDED.retain_months
                        """)
                .param("category", category.name())
                .param("months", retainMonths)
                .update();
    }

    public boolean removePolicy(RetentionCategory category) {
        return jdbc.sql("DELETE FROM retention_policy WHERE category = :category")
                .param("category", category.name())
                .update() > 0;
    }

    /** Deletes every open preview that applies a cut-off of the category; returns how many. */
    public int discardPreviewsCovering(RetentionCategory category) {
        String cutoff = switch (category) {
            case BOOKINGS -> "bookings_ended_before";
            case FORMER_MEMBERS -> "memberships_ended_before";
        };
        return jdbc.sql("DELETE FROM retention_preview WHERE " + cutoff + " IS NOT NULL").update();
    }

    public long dueBookings(Instant endedBefore) {
        return jdbc.sql("SELECT count(*) FROM (" + DUE_BOOKINGS + ") due")
                .param("endedBefore", utc(endedBefore))
                .query(Long.class)
                .single();
    }

    public long dueSeries(Instant endedBefore) {
        return jdbc.sql("""
                        SELECT count(*) FROM booking_series s
                        WHERE s.pseudonymised_at IS NULL
                          AND EXISTS (SELECT 1 FROM booking b WHERE b.series_id = s.id)
                          AND NOT EXISTS (SELECT 1 FROM booking b WHERE b.series_id = s.id
                                          AND b.pseudonymised_at IS NULL AND b.id NOT IN (%s))
                        """.formatted(DUE_BOOKINGS))
                .param("endedBefore", utc(endedBefore))
                .query(Long.class)
                .single();
    }

    /** Pseudonymises every booking and series that ended before the instant; returns the two counts. */
    public long[] pseudonymise(Instant endedBefore, Instant now) {
        OffsetDateTime before = utc(endedBefore);
        jdbc.sql("SELECT b.id FROM booking b WHERE b.pseudonymised_at IS NULL AND " + BOOKING_END
                        + " < :endedBefore FOR UPDATE OF b")
                .param("endedBefore", before)
                .query(UUID.class)
                .list();
        jdbc.sql("DELETE FROM partner_invitation WHERE booking_id IN (" + DUE_BOOKINGS + ")")
                .param("endedBefore", before).update();
        jdbc.sql("DELETE FROM booking_participant WHERE kind = 'MEMBER' AND booking_id IN (" + DUE_BOOKINGS + ")")
                .param("endedBefore", before).update();
        jdbc.sql("UPDATE booking_participant SET guest_name = '' WHERE kind = 'GUEST' AND booking_id IN ("
                        + DUE_BOOKINGS + ")")
                .param("endedBefore", before).update();
        jdbc.sql("UPDATE booking_attendance SET recorded_by = NULL, lifted_by = NULL WHERE booking_id IN ("
                        + DUE_BOOKINGS + ")")
                .param("endedBefore", before).update();
        long bookings = jdbc.sql("""
                        UPDATE booking SET booked_by = NULL, cancelled_by = NULL, moved_by = NULL, acted_by = NULL,
                                           note = NULL, pseudonymised_at = :now
                        WHERE id IN (%s)
                        """.formatted(DUE_BOOKINGS))
                .param("endedBefore", before)
                .param("now", utc(now))
                .update();
        long series = jdbc.sql("""
                        UPDATE booking_series s SET created_by = NULL, note = NULL, pseudonymised_at = :now
                        WHERE s.pseudonymised_at IS NULL
                          AND EXISTS (SELECT 1 FROM booking b WHERE b.series_id = s.id)
                          AND NOT EXISTS (SELECT 1 FROM booking b WHERE b.series_id = s.id
                                          AND b.pseudonymised_at IS NULL)
                        """)
                .param("now", utc(now))
                .update();
        forgetWhoTouched(jdbc.sql("""
                        SELECT id FROM booking WHERE pseudonymised_at = :now
                        UNION ALL SELECT id FROM booking_series WHERE pseudonymised_at = :now
                        """)
                .param("now", utc(now))
                .query(String.class)
                .list());
        return new long[]{bookings, series};
    }

    // The change log, the notification centre and the outbox would otherwise still tie these records to a person.
    private void forgetWhoTouched(List<String> recordIds) {
        if (recordIds.isEmpty()) {
            return;
        }
        String ids = recordIds.stream().collect(Collectors.joining(",", "{", "}"));
        jdbc.sql("""
                        UPDATE domain_event
                        SET actor_account_id = NULL,
                            payload = payload - ARRAY(SELECT key FROM jsonb_object_keys(payload) key
                                                      WHERE key ~* :personal)
                        WHERE jsonb_typeof(payload) = 'object'
                          AND (subject_id = ANY (CAST(:ids AS uuid[]))
                               OR payload ->> 'bookingId' = ANY (CAST(:ids AS text[]))
                               OR payload ->> 'seriesId' = ANY (CAST(:ids AS text[]))
                               OR (jsonb_typeof(payload -> 'bookingIds') = 'array'
                                   AND jsonb_exists_any(payload -> 'bookingIds', CAST(:ids AS text[]))))
                        """)
                .param("ids", ids)
                .param("personal", PERSONAL_PAYLOAD_FIELD)
                .update();
        jdbc.sql("DELETE FROM notification WHERE parameters ->> 'bookingId' = ANY (CAST(:ids AS text[]))")
                .param("ids", ids)
                .update();
        jdbc.sql("""
                        DELETE FROM message_record
                        WHERE parameters ->> 'bookingId' = ANY (CAST(:ids AS text[]))
                           OR parameters ->> 'seriesId' = ANY (CAST(:ids AS text[]))
                           OR string_to_array(parameters ->> 'bookingIds', ',') && CAST(:ids AS text[])
                        """)
                .param("ids", ids)
                .update();
        jdbc.sql("""
                        DELETE FROM event_publication
                        WHERE completion_date IS NULL
                          AND EXISTS (SELECT 1 FROM unnest(CAST(:ids AS text[])) id
                                      WHERE strpos(serialized_event, id) > 0)
                        """)
                .param("ids", ids)
                .update();
    }

    public List<UUID> formerMembers(LocalDate membershipEndedBefore, Instant activeSince) {
        return jdbc.sql("""
                        SELECT p.id FROM person p JOIN member m ON m.person_id = p.id
                        WHERE NOT EXISTS (SELECT 1 FROM user_account u WHERE u.person_id = p.id
                                          AND (u.created_at >= :activeSince OR u.last_login_at >= :activeSince))
                        GROUP BY p.id
                        HAVING bool_and(m.ended_on IS NOT NULL) AND max(m.ended_on) < :endedBefore
                        ORDER BY p.id
                        """)
                .param("endedBefore", membershipEndedBefore)
                .param("activeSince", utc(activeSince))
                .query(UUID.class)
                .list();
    }

    public long accountsOf(List<UUID> personIds) {
        if (personIds.isEmpty()) {
            return 0;
        }
        return jdbc.sql("SELECT count(*) FROM user_account WHERE person_id IN (:ids)")
                .param("ids", personIds)
                .query(Long.class)
                .single();
    }

    /** What keeps each person from removal, in the order the reasons are reported; absent when nothing does. */
    public Map<UUID, BlockReason> blocks(List<UUID> personIds, @Nullable Instant bookingsEndedBefore) {
        Map<UUID, BlockReason> blocks = new LinkedHashMap<>();
        if (personIds.isEmpty()) {
            return blocks;
        }
        jdbc.sql("""
                        SELECT p.id,
                               EXISTS (SELECT 1 FROM user_account u JOIN user_account_role r ON r.user_account_id = u.id
                                       WHERE u.person_id = p.id AND r.role = 'ADMIN') AS administrator,
                               (EXISTS (SELECT 1 FROM booking_participant bp JOIN booking b ON b.id = bp.booking_id
                                        WHERE bp.person_id = p.id AND %1$s)
                                OR EXISTS (SELECT 1 FROM booking b JOIN user_account u
                                             ON u.id IN (b.booked_by, b.cancelled_by, b.moved_by, b.acted_by)
                                           WHERE u.person_id = p.id AND %1$s)
                                OR EXISTS (SELECT 1 FROM booking_series s JOIN user_account u ON u.id = s.created_by
                                           WHERE u.person_id = p.id
                                             AND (NOT EXISTS (SELECT 1 FROM booking b WHERE b.series_id = s.id)
                                                  OR EXISTS (SELECT 1 FROM booking b WHERE b.series_id = s.id
                                                             AND b.pseudonymised_at IS NULL AND %1$s)))) AS named,
                               (EXISTS (SELECT 1 FROM waitlist_participant wp WHERE wp.person_id = p.id)
                                OR EXISTS (SELECT 1 FROM waitlist_entry we JOIN user_account u ON u.id = we.account_id
                                           WHERE u.person_id = p.id)) AS waiting
                        FROM person p WHERE p.id IN (:ids)
                        ORDER BY p.id
                        """.formatted(NOT_COVERED))
                .param("ids", personIds)
                .param("endedBefore", bookingsEndedBefore == null ? null : utc(bookingsEndedBefore))
                .query(rs -> {
                    UUID personId = rs.getObject("id", UUID.class);
                    if (rs.getBoolean("administrator")) {
                        blocks.put(personId, BlockReason.ADMINISTRATOR);
                    } else if (rs.getBoolean("named")) {
                        blocks.put(personId, BlockReason.NAMED_IN_BOOKINGS);
                    } else if (rs.getBoolean("waiting")) {
                        blocks.put(personId, BlockReason.ON_A_WAITING_LIST);
                    }
                });
        return blocks;
    }

    /** Locks the person, re-checks eligibility and removes them with their accounts; empty when skipped. */
    public Optional<Long> removeIfStillEligible(UUID personId, LocalDate membershipEndedBefore, Instant activeSince) {
        boolean present = !jdbc.sql("SELECT id FROM person WHERE id = :id FOR UPDATE")
                .param("id", personId)
                .query(UUID.class)
                .list()
                .isEmpty();
        if (!present) {
            return Optional.empty();
        }
        jdbc.sql("SELECT id FROM user_account WHERE person_id = :id FOR UPDATE")
                .param("id", personId).query(UUID.class).list();
        jdbc.sql("SELECT id FROM member WHERE person_id = :id FOR UPDATE")
                .param("id", personId).query(UUID.class).list();
        if (!formerMembers(membershipEndedBefore, activeSince).contains(personId)
                || blocks(List.of(personId), null).containsKey(personId)) {
            return Optional.empty();
        }
        List<String> usernames = jdbc.sql("SELECT username FROM user_account WHERE person_id = :id")
                .param("id", personId).query(String.class).list();
        if (!usernames.isEmpty()) {
            jdbc.sql("DELETE FROM spring_session WHERE principal_name IN (:names)")
                    .param("names", usernames).update();
        }
        long accounts = jdbc.sql("DELETE FROM user_account WHERE person_id = :id").param("id", personId).update();
        jdbc.sql("DELETE FROM import_external_reference WHERE person_id = :id").param("id", personId).update();
        jdbc.sql("DELETE FROM guardian_relationship WHERE guardian_person_id = :id OR dependant_person_id = :id")
                .param("id", personId).update();
        jdbc.sql("DELETE FROM member WHERE person_id = :id").param("id", personId).update();
        jdbc.sql("DELETE FROM person WHERE id = :id").param("id", personId).update();
        return Optional.of(accounts);
    }

    public void savePreview(UUID previewId, UUID createdBy, Instant createdAt, Instant expiresAt,
                            @Nullable Instant bookingsEndedBefore, @Nullable LocalDate membershipsEndedBefore,
                            List<UUID> formerMemberIds) {
        jdbc.sql("""
                        INSERT INTO retention_preview (id, created_by, created_at, expires_at, bookings_ended_before,
                                                       memberships_ended_before, former_member_ids)
                        VALUES (:id, :createdBy, :createdAt, :expiresAt, :bookingsEndedBefore,
                                :membershipsEndedBefore, CAST(:formerMemberIds AS uuid[]))
                        """)
                .param("id", previewId)
                .param("createdBy", createdBy)
                .param("createdAt", utc(createdAt))
                .param("expiresAt", utc(expiresAt))
                .param("bookingsEndedBefore", bookingsEndedBefore == null ? null : utc(bookingsEndedBefore))
                .param("membershipsEndedBefore", membershipsEndedBefore)
                .param("formerMemberIds", formerMemberIds.stream().map(UUID::toString)
                        .collect(Collectors.joining(",", "{", "}")))
                .update();
    }

    public record StoredPreview(UUID createdBy, Instant createdAt, Instant expiresAt, @Nullable Instant bookingsEndedBefore,
                                @Nullable LocalDate membershipsEndedBefore, List<UUID> formerMemberIds) {
    }

    public Optional<StoredPreview> lockPreview(UUID previewId) {
        return jdbc.sql("""
                        SELECT created_by, created_at, expires_at, bookings_ended_before, memberships_ended_before,
                               former_member_ids
                        FROM retention_preview WHERE id = :id FOR UPDATE
                        """)
                .param("id", previewId)
                .query((rs, row) -> new StoredPreview(
                        rs.getObject("created_by", UUID.class),
                        rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                        rs.getObject("expires_at", OffsetDateTime.class).toInstant(),
                        Optional.ofNullable(rs.getObject("bookings_ended_before", OffsetDateTime.class))
                                .map(OffsetDateTime::toInstant).orElse(null),
                        rs.getObject("memberships_ended_before", LocalDate.class),
                        uuids(rs.getArray("former_member_ids"))))
                .optional();
    }

    public void deletePreview(UUID previewId) {
        jdbc.sql("DELETE FROM retention_preview WHERE id = :id").param("id", previewId).update();
    }

    public int deleteExpiredPreviews(Instant now) {
        return jdbc.sql("DELETE FROM retention_preview WHERE expires_at <= :now").param("now", utc(now)).update();
    }

    private static List<UUID> uuids(Array array) throws SQLException {
        Object values = array.getArray();
        if (values instanceof UUID[] ids) {
            return List.of(ids);
        }
        List<UUID> ids = new ArrayList<>();
        Arrays.stream((Object[]) values).forEach(value -> ids.add(UUID.fromString(value.toString())));
        return ids;
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
