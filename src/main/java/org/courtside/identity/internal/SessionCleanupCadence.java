package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.session.jdbc.autoconfigure.JdbcSessionProperties;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class SessionCleanupCadence implements InitializingBean {

    // Spring Session reads a lone "-" as "schedule nothing at all"; expired rows must be deleted.
    private static final String CLEANUP_OFF = "-";

    private final JdbcSessionProperties properties;

    @Override
    public void afterPropertiesSet() {
        if (CLEANUP_OFF.equals(properties.getCleanupCron())) {
            throw new IllegalStateException("spring.session.jdbc.cleanup-cron names how often expired"
                    + " sessions are deleted; \"" + CLEANUP_OFF + "\" switches the session cleanup"
                    + " off, which no deployment may do");
        }
    }
}
