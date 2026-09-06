package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.session.autoconfigure.SessionProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
@RequiredArgsConstructor
class SessionLifetimeGuard implements InitializingBean {

    private final SessionProperties inactivity;
    private final SessionLifetimeProperties lifetime;

    @Override
    public void afterPropertiesSet() {
        Duration timeout = inactivity.getTimeout();
        if (timeout == null) {
            throw new IllegalStateException("COURTSIDE_SESSION_INACTIVITY_TIMEOUT is unset, so the"
                    + " inactivity window would be whatever Spring defaults to that day rather than"
                    + " the value this deployment states");
        }
        if (lifetime.absoluteLifetime().compareTo(timeout) < 0) {
            throw new IllegalStateException("COURTSIDE_SESSION_ABSOLUTE_LIFETIME (" + lifetime.absoluteLifetime()
                    + ") is shorter than COURTSIDE_SESSION_INACTIVITY_TIMEOUT (" + timeout + "), so the"
                    + " inactivity window can never be reached and configuring it would say nothing");
        }
    }
}
