package org.courtside.shared.internal;

import lombok.extern.slf4j.Slf4j;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.WarmUpStep;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

@Slf4j
class StartupWarmUp {

    private final List<WarmUpStep> steps;
    private final WarmUpProperties properties;
    private volatile boolean stopped;

    StartupWarmUp(List<WarmUpStep> steps, WarmUpProperties properties) {
        this.steps = List.copyOf(steps);
        this.properties = properties;
    }

    // Spring Boot accepts traffic only after every ApplicationReadyEvent listener has returned.
    @EventListener(ApplicationReadyEvent.class)
    void beforeReadiness(ApplicationReadyEvent ready) {
        if (properties.enabled()) {
            run();
        }
    }

    Report run() {
        long started = System.nanoTime();
        stopped = false;
        Progress progress = new Progress();
        ExecutorService worker = Executors.newSingleThreadExecutor(
                Thread.ofPlatform().name("warm-up").daemon().factory());
        try {
            Future<?> exercise = worker.submit(() -> exercise(progress));
            exercise.get(properties.deadline().toMillis(), TimeUnit.MILLISECONDS);
            Report report = progress.report(true);
            log.info("Warm-up finished in {} ms over {} rounds; ran {}, skipped {}, failed {}",
                    elapsedMillis(started), properties.rounds(), report.ran(), report.skipped(), report.failed());
            return report;
        } catch (TimeoutException deadline) {
            Report report = progress.report(false);
            log.warn("Warm-up stopped at its deadline of {} after {} ms; ran {}, skipped {}, failed {}",
                    properties.deadline(), elapsedMillis(started), report.ran(), report.skipped(), report.failed());
            return report;
        } catch (ExecutionException failure) {
            log.warn("Warm-up ended after {} ms: {}", elapsedMillis(started), causeTypes(failure.getCause()));
            return progress.report(false);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return progress.report(false);
        } finally {
            stopped = true;
            worker.shutdownNow();
        }
    }

    private void exercise(Progress progress) {
        List<WarmUpStep> active = new ArrayList<>(steps);
        for (int round = 0; round < properties.rounds() && !active.isEmpty(); round++) {
            for (WarmUpStep step : List.copyOf(active)) {
                if (stopped || Thread.currentThread().isInterrupted()) {
                    return;
                }
                if (round >= step.roundBudget()) {
                    active.remove(step);
                    continue;
                }
                try {
                    if (step.run()) {
                        progress.ran(step.name());
                    } else {
                        active.remove(step);
                        progress.skipped(step.name());
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return;
                } catch (Exception failure) {
                    active.remove(step);
                    progress.failed(step.name());
                    log.warn("Warm-up step {} failed: {}", step.name(), causeTypes(failure));
                }
            }
        }
    }

    // No messages: one may carry data the request path read.
    private static String causeTypes(Throwable failure) {
        List<String> types = new ArrayList<>();
        for (Throwable cause = failure; cause != null && types.size() < 10; cause = cause.getCause()) {
            types.add(cause.getClass().getSimpleName() + detail(cause));
        }
        return String.join(" <- ", types);
    }

    private static String detail(Throwable cause) {
        if (cause instanceof WarmUpRequestRefusedException refused) {
            return " (" + refused.getMessage() + ")";
        }
        if (cause instanceof DomainFailure domain) {
            List<Object> codes = domain.getBody().getProperties() != null
                    && domain.getBody().getProperties().get("violations") instanceof List<?> violations
                    ? violations.stream()
                            .map(violation -> violation instanceof Map<?, ?> entry ? entry.get("code") : null)
                            .filter(Objects::nonNull)
                            .map(Object.class::cast)
                            .toList()
                    : List.of();
            return " (" + domain.problemType().uri() + (codes.isEmpty() ? "" : " " + codes) + ")";
        }
        return "";
    }

    private static long elapsedMillis(long started) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
    }

    record Report(List<String> ran, List<String> skipped, List<String> failed, boolean completed) {
    }

    private static final class Progress {

        private final Set<String> ran = new LinkedHashSet<>();
        private final Set<String> skipped = new LinkedHashSet<>();
        private final Set<String> failed = new LinkedHashSet<>();

        synchronized void ran(String step) {
            ran.add(step);
        }

        synchronized void skipped(String step) {
            skipped.add(step);
        }

        synchronized void failed(String step) {
            ran.remove(step);
            failed.add(step);
        }

        synchronized Report report(boolean completed) {
            return new Report(List.copyOf(ran), List.copyOf(skipped), List.copyOf(failed), completed);
        }
    }
}
