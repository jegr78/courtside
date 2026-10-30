package org.courtside.access.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.access.AccessGrantEvent;
import org.courtside.access.ProbeOutcome;
import org.courtside.config.AccessPolicy;
import org.jspecify.annotations.Nullable;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

@Component
@RequiredArgsConstructor
class AccessGrantTransitions {

    private final AccessCodes codes;
    private final AccessPolicy policy;
    private final ApplicationEventPublisher events;

    Decision decide(AccessGrant grant, @Nullable Demand demand, @Nullable String mapping, Instant dbNow) {
        Action action = grant.decide(demand, mapping, dbNow);
        String code = codes.currentCode(grant.getId()).orElse(null);
        if (grant.isWanted() && code == null) {
            code = codes.draw(grant.getId(), policy.accessCodeLength());
        }
        return new Decision(action, code);
    }

    void decisionFailed(AccessGrant grant, String reason, Instant dbNow) {
        if (grant.decisionFailed(reason, dbNow)) {
            events.publishEvent(new AccessGrantEvent.Failing(grant.getBookingId()));
        }
    }

    Recording record(AccessGrant grant, SentCall call, CallResult result, @Nullable ProbeOutcome reprobe,
                     Instant dbNow, Duration deadline) {
        Recording recording = grant.record(call, result, reprobe, dbNow, deadline);
        if (recording.firstAccepted()) {
            events.publishEvent(new AccessGrantEvent.Installed(grant.getBookingId()));
        }
        if (recording.becameFailing()) {
            events.publishEvent(new AccessGrantEvent.Failing(grant.getBookingId()));
        }
        if (recording.replaceCode()) {
            codes.detach(grant.getId(), grant.getExposedUntil());
            codes.draw(grant.getId(), policy.accessCodeLength());
        }
        return recording;
    }
}
