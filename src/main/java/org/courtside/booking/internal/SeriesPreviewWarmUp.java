package org.courtside.booking.internal;

import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesService;
import org.courtside.identity.Role;
import org.courtside.shared.WarmUpStep;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Optional;
import java.util.Set;

@Component
@Order(30)
class SeriesPreviewWarmUp implements WarmUpStep {

    private static final int DAYS_AHEAD = 7;
    private static final int OCCURRENCES = 12;
    private static final int TRANSACTION_TIMEOUT_SECONDS = 10;

    private final WarmUpTarget targets;
    private final SeriesService series;
    private final TransactionTemplate transaction;

    SeriesPreviewWarmUp(WarmUpTarget targets, SeriesService series, PlatformTransactionManager transactions) {
        this.targets = targets;
        this.series = series;
        this.transaction = new TransactionTemplate(transactions);
        this.transaction.setReadOnly(true);
        this.transaction.setTimeout(TRANSACTION_TIMEOUT_SECONDS);
    }

    @Override
    public String name() {
        return "series-preview";
    }

    // A trainer rather than an administrator, so the overridable rules are evaluated as well.
    @Override
    public boolean run() {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            status.setRollbackOnly();
            Optional<WarmUpTarget.Target> target = targets.find(DAYS_AHEAD);
            if (target.isEmpty()) {
                return false;
            }
            series.preview(new SeriesRule(List.of(target.get().courtId()), target.get().cardId(),
                            target.get().date(), target.get().startTime(), target.get().minutes(), 1,
                            Set.of(target.get().date().getDayOfWeek()), null, OCCURRENCES),
                    WarmUpTarget.BOOKER, null, Set.of(Role.TRAINER));
            return true;
        }));
    }
}
