package org.courtside.member.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.CredentialState;
import org.courtside.identity.Role;
import org.courtside.member.RosterService;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Repository
@RequiredArgsConstructor
public class RosterListQuery {

    private final JdbcClient jdbc;

    public List<UUID> findIds(String nameFragment, UUID membershipTypeId, Role role,
                              Set<CredentialState> credentialStates, Instant now,
                              RosterService.SortField field,
                              RosterService.SortDirection direction,
                              UUID cursor, int limit) {
        Map<String, Object> parameters = new HashMap<>();
        String roster = roster(criteria(nameFragment, membershipTypeId, role, credentialStates, now,
                parameters));
        if (cursor != null) {
            parameters.put("cursor", cursor);
            Integer matches = jdbc.sql(roster + " SELECT count(*) FROM roster WHERE id = :cursor")
                    .params(parameters).query(Integer.class).single();
            if (matches == 0) {
                throw new RosterCursorUnknownException("roster.cursor.unknown", Map.of());
            }
        }
        parameters.put("limit", limit);
        String ordered = cursor == null
                ? "SELECT r.id FROM roster r"
                : "SELECT r.id FROM roster r CROSS JOIN "
                    + "(SELECT * FROM roster WHERE id = :cursor) c WHERE "
                    + after(field, direction);
        return jdbc.sql(roster + " " + ordered + " ORDER BY " + order(field, direction)
                        + " LIMIT :limit")
                .params(parameters).query(UUID.class).list();
    }

    public long count(String nameFragment, UUID membershipTypeId, Role role,
                      Set<CredentialState> credentialStates, Instant now) {
        Map<String, Object> parameters = new HashMap<>();
        String roster = roster(criteria(nameFragment, membershipTypeId, role, credentialStates, now,
                parameters));
        return jdbc.sql(roster + " SELECT count(*) FROM roster")
                .params(parameters).query(Long.class).single();
    }

    private static String criteria(String nameFragment, UUID membershipTypeId, Role role,
                                   Set<CredentialState> credentialStates, Instant now,
                                   Map<String, Object> parameters) {
        parameters.put("nameFragment", nameFragment);
        parameters.put("now", now.atOffset(ZoneOffset.UTC));
        StringBuilder criteria = new StringBuilder("""
                WHERE lower(concat(p.first_name, ' ', p.last_name))
                      LIKE concat('%', :nameFragment, '%') ESCAPE '!'
                """);
        if (membershipTypeId != null) {
            criteria.append("""
                    AND EXISTS (SELECT 1 FROM member filtered_member
                                WHERE filtered_member.person_id = p.id
                                  AND filtered_member.membership_type_id = :membershipTypeId
                                  AND filtered_member.ended_on IS NULL)
                    """);
            parameters.put("membershipTypeId", membershipTypeId);
        }
        if (role != null) {
            criteria.append("""
                    AND EXISTS (SELECT 1 FROM user_account_role filtered_role
                                WHERE filtered_role.user_account_id = account.id
                                  AND filtered_role.role = :role)
                    """);
            parameters.put("role", role.name());
        }
        if (credentialStates != null && !credentialStates.isEmpty()) {
            criteria.append("AND credential.state IN (:credentialStates)\n");
            parameters.put("credentialStates", credentialStates.stream().map(Enum::name).toList());
        }
        return criteria.toString();
    }

    private static String roster(String criteria) {
        return """
                WITH roster AS (
                    SELECT p.id,
                           lower(p.last_name) AS last_name,
                           lower(p.first_name) AS first_name,
                           lower(account.username) AS username,
                           CASE WHEN account.id IS NULL THEN 2
                                WHEN account.enabled THEN 0 ELSE 1 END AS account_rank,
                           lower(membership.name) AS membership_name,
                           roles.names AS role_names
                    FROM person p
                    LEFT JOIN LATERAL (
                        SELECT candidate.id, candidate.username, candidate.enabled,
                               candidate.password_hash, candidate.password_change_required,
                               candidate.credentials_expire_at
                        FROM user_account candidate
                        WHERE candidate.person_id = p.id
                        ORDER BY candidate.enabled DESC, candidate.created_at, candidate.id
                        LIMIT 1
                    ) account ON TRUE
                    CROSS JOIN LATERAL (
                        SELECT CASE WHEN account.id IS NULL THEN NULL
                                    WHEN account.password_hash IS NULL THEN 'AWAITING_CREDENTIAL'
                                    WHEN NOT account.password_change_required THEN 'PASSWORD_CHOSEN'
                                    WHEN account.credentials_expire_at <= :now THEN 'CREDENTIAL_EXPIRED'
                                    ELSE 'CREDENTIAL_ISSUED' END AS state
                    ) credential
                    LEFT JOIN LATERAL (
                        SELECT type.name
                        FROM member held
                        JOIN membership_type type ON type.id = held.membership_type_id
                        WHERE held.person_id = p.id
                        LIMIT 1
                    ) membership ON TRUE
                    LEFT JOIN LATERAL (
                        SELECT string_agg(held_role.role, ',' ORDER BY held_role.role) AS names
                        FROM user_account_role held_role
                        WHERE held_role.user_account_id = account.id
                    ) roles ON TRUE
                """ + criteria + ")";
    }

    private static String order(RosterService.SortField field,
                                RosterService.SortDirection direction) {
        String order = direction == RosterService.SortDirection.ASC ? "ASC" : "DESC";
        return switch (field) {
            case NAME -> "r.last_name " + order + ", r.first_name " + order + ", r.id ASC";
            case USERNAME -> "r.username IS NULL, r.username " + order + ", r.id ASC";
            case ACCOUNT -> "r.account_rank " + order + ", r.id ASC";
            case MEMBERSHIP_TYPE -> "r.membership_name IS NULL, r.membership_name " + order + ", r.id ASC";
            case ROLES -> "r.role_names IS NULL, r.role_names " + order + ", r.id ASC";
        };
    }

    private static String after(RosterService.SortField field,
                                RosterService.SortDirection direction) {
        String comparison = direction == RosterService.SortDirection.ASC ? ">" : "<";
        return switch (field) {
            case NAME -> afterName(comparison);
            case USERNAME -> afterNullable("username", comparison);
            case ACCOUNT -> "r.account_rank " + comparison + " c.account_rank OR "
                    + "(r.account_rank = c.account_rank AND r.id > c.id)";
            case MEMBERSHIP_TYPE -> afterNullable("membership_name", comparison);
            case ROLES -> afterNullable("role_names", comparison);
        };
    }

    private static String afterName(String comparison) {
        return "r.last_name " + comparison + " c.last_name OR "
                + "(r.last_name = c.last_name AND (r.first_name " + comparison
                + " c.first_name OR (r.first_name = c.first_name AND r.id > c.id)))";
    }

    private static String afterNullable(String column, String comparison) {
        return "(r." + column + " IS NULL) > (c." + column + " IS NULL) OR "
                + "((r." + column + " IS NULL) = (c." + column + " IS NULL) AND ("
                + "(r." + column + " IS NULL AND r.id > c.id) OR "
                + "(r." + column + " IS NOT NULL AND (r." + column + " " + comparison
                + " c." + column + " OR (r." + column + " = c." + column
                + " AND r.id > c.id)))))";
    }
}
