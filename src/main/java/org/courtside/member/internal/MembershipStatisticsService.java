package org.courtside.member.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.member.MembershipStatistics;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
class MembershipStatisticsService implements MembershipStatistics {

    private final JdbcClient jdbc;

    @Override
    public MembershipFigures figures(LocalDate from, LocalDate to) {
        requirePeriod(from, to);
        return jdbc.sql("""
                        SELECT COUNT(*) FILTER (WHERE started_on <= :to
                                                  AND (ended_on IS NULL OR ended_on > :to)) AS running,
                               COUNT(*) FILTER (WHERE started_on BETWEEN :from AND :to) AS joins,
                               COUNT(*) FILTER (WHERE ended_on BETWEEN :from AND :to) AS leavings
                        FROM member
                        """)
                .param("from", from)
                .param("to", to)
                .query((rs, row) -> new MembershipFigures(
                        rs.getLong("running"), rs.getLong("joins"), rs.getLong("leavings")))
                .single();
    }

    @Override
    public List<MembershipTypeCount> runningByType(LocalDate day) {
        if (day == null) {
            throw new IllegalStateException("Counting memberships needs a day");
        }
        return jdbc.sql("""
                        SELECT t.id, t.name, COUNT(m.id) AS members
                        FROM membership_type t
                        LEFT JOIN member m
                          ON m.membership_type_id = t.id
                         AND m.started_on <= :day
                         AND (m.ended_on IS NULL OR m.ended_on > :day)
                        GROUP BY t.id, t.name
                        ORDER BY t.name, t.id
                        """)
                .param("day", day)
                .query((rs, row) -> new MembershipTypeCount(
                        rs.getObject("id", UUID.class), rs.getString("name"), rs.getLong("members")))
                .list();
    }

    private static void requirePeriod(LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from)) {
            throw new IllegalStateException("Membership figures need a resolved period");
        }
    }
}
