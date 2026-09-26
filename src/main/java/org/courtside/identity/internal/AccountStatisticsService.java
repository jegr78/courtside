package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubTimeZone;
import org.courtside.identity.AccountStatistics;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
class AccountStatisticsService implements AccountStatistics {

    private final JdbcClient jdbc;
    private final ClubTimeZone clubTimeZone;

    @Override
    public AccountFigures figuresAsOf(LocalDate lastDay) {
        if (lastDay == null) {
            throw new IllegalStateException("Account figures need the period's last day");
        }
        return jdbc.sql("""
                        WITH bounds AS (
                            SELECT timezone(:zone, CAST(:lastDay AS timestamp) + interval '1 day') AS ends_at,
                                   timezone(:zone, CAST(:lastDay AS timestamp) - interval '29 days') AS within_30,
                                   timezone(:zone, CAST(:lastDay AS timestamp) - interval '89 days') AS within_90
                        )
                        SELECT COUNT(*) AS accounts,
                               COUNT(*) FILTER (WHERE a.password_hash IS NOT NULL
                                                  AND NOT a.password_change_required) AS password_chosen,
                               COUNT(*) FILTER (WHERE a.last_login_at >= b.within_30
                                                  AND a.last_login_at < b.ends_at) AS within_30,
                               COUNT(*) FILTER (WHERE a.last_login_at >= b.within_90
                                                  AND a.last_login_at < b.ends_at) AS within_90,
                               COUNT(*) FILTER (WHERE a.last_login_at IS NULL) AS never
                        FROM user_account a
                        CROSS JOIN bounds b
                        WHERE a.enabled
                        """)
                .param("zone", clubTimeZone.zoneId().getId())
                .param("lastDay", lastDay)
                .query((rs, row) -> {
                    long accounts = rs.getLong("accounts");
                    long chosen = rs.getLong("password_chosen");
                    return new AccountFigures(accounts, chosen, accounts - chosen,
                            rs.getLong("within_30"), rs.getLong("within_90"), rs.getLong("never"));
                })
                .single();
    }
}
