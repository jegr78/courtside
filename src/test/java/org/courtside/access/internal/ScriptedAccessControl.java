package org.courtside.access.internal;

import org.courtside.access.AccessControlConnector;
import org.courtside.access.GrantInstruction;
import org.courtside.access.GrantOutcome;
import org.courtside.access.GrantReference;
import org.courtside.access.ProbeOutcome;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.function.Function;

/** A connector whose every answer a test chooses, and which records each call it receives. */
public final class ScriptedAccessControl implements AccessControlConnector {

    public enum Kind { GRANT, RESCHEDULE, REVOKE, PROBE }

    public record Call(Kind kind, UUID grantId, Instant at, boolean overlapped, String code) {
    }

    public sealed interface Step {

        record Answer(GrantOutcome outcome) implements Step {
        }

        record Probe(ProbeOutcome outcome) implements Step {
        }

        record Fail(Throwable failure) implements Step {
        }

        /** Throws what the function builds from the code the call carries. */
        record FailWithCode(Function<String, RuntimeException> failure) implements Step {
        }

        /** Blocks until interrupted. */
        record Hang() implements Step {
        }

        /** Blocks and ignores interrupts until the test releases it. */
        record Stubborn() implements Step {
        }

        record Then(Runnable action, Step next) implements Step {
        }
    }

    private final List<Call> calls = new CopyOnWriteArrayList<>();
    private final Map<UUID, Step> alwaysForGrant = new ConcurrentHashMap<>();
    private final Deque<Step> installs = new ArrayDeque<>();
    private final Deque<Step> revokes = new ArrayDeque<>();
    private final Deque<Step> probes = new ArrayDeque<>();
    private final AtomicInteger inFlight = new AtomicInteger();
    private volatile Step defaultInstall;
    private volatile Step defaultRevoke;
    private volatile Step defaultProbe;
    private volatile Function<Set<UUID>, String> mapping;
    private volatile Consumer<Set<UUID>> mappingHook;
    private volatile CountDownLatch stubbornRelease;

    public ScriptedAccessControl() {
        reset();
    }

    public synchronized void reset() {
        calls.clear();
        alwaysForGrant.clear();
        installs.clear();
        revokes.clear();
        probes.clear();
        defaultInstall = null;
        defaultRevoke = null;
        defaultProbe = new Step.Probe(new ProbeOutcome.Answered());
        mapping = points -> "mapping-v1";
        mappingHook = points -> { };
        if (stubbornRelease != null) {
            stubbornRelease.countDown();
        }
        stubbornRelease = new CountDownLatch(1);
    }

    public synchronized void nextInstalls(Step... steps) {
        installs.addAll(List.of(steps));
    }

    public synchronized void nextRevokes(Step... steps) {
        revokes.addAll(List.of(steps));
    }

    public synchronized void nextProbes(Step... steps) {
        probes.addAll(List.of(steps));
    }

    public void everyInstall(Step step) {
        defaultInstall = step;
    }

    public void everyRevoke(Step step) {
        defaultRevoke = step;
    }

    public void everyProbe(Step step) {
        defaultProbe = step;
    }

    public void alwaysFor(UUID grantId, Step step) {
        alwaysForGrant.put(grantId, step);
    }

    public void mapping(Function<Set<UUID>, String> fingerprint) {
        mapping = fingerprint;
    }

    public void whileMapping(Consumer<Set<UUID>> hook) {
        mappingHook = hook;
    }

    public void releaseStubbornCalls() {
        stubbornRelease.countDown();
    }

    public List<Call> calls() {
        return List.copyOf(calls);
    }

    public List<Call> calls(Kind kind) {
        return calls.stream().filter(call -> call.kind() == kind).toList();
    }

    @Override
    public GrantOutcome grant(GrantInstruction instruction) {
        return install(Kind.GRANT, instruction);
    }

    @Override
    public GrantOutcome reschedule(GrantInstruction instruction) {
        return install(Kind.RESCHEDULE, instruction);
    }

    @Override
    public GrantOutcome revoke(GrantReference reference) {
        UUID grant = reference.grantId();
        return (GrantOutcome) perform(Kind.REVOKE, grant, null,
                stepFor(grant, revokes, defaultRevoke, new Step.Answer(new GrantOutcome.Accepted("remote-" + grant))));
    }

    @Override
    public ProbeOutcome probe() {
        return (ProbeOutcome) perform(Kind.PROBE, null, null, next(probes, defaultProbe));
    }

    @Override
    public String mappingOf(Set<UUID> accessPointIds) {
        mappingHook.accept(accessPointIds);
        return mapping.apply(accessPointIds);
    }

    private GrantOutcome install(Kind kind, GrantInstruction instruction) {
        UUID grant = instruction.reference().grantId();
        return (GrantOutcome) perform(kind, grant, instruction.code(),
                stepFor(grant, installs, defaultInstall, new Step.Answer(new GrantOutcome.Accepted("remote-" + grant))));
    }

    private synchronized Step stepFor(UUID grant, Deque<Step> queue, Step fallback, Step accept) {
        Step always = alwaysForGrant.get(grant);
        if (always != null) {
            return always;
        }
        Step queued = queue.poll();
        if (queued != null) {
            return queued;
        }
        return fallback == null ? accept : fallback;
    }

    private synchronized Step next(Deque<Step> queue, Step fallback) {
        Step queued = queue.poll();
        return queued == null ? fallback : queued;
    }

    private Object perform(Kind kind, UUID grant, String code, Step step) {
        boolean overlapped = inFlight.incrementAndGet() > 1;
        calls.add(new Call(kind, grant, Instant.now(), overlapped, code));
        try {
            return execute(step, code);
        } finally {
            inFlight.decrementAndGet();
        }
    }

    private Object execute(Step step, String code) {
        return switch (step) {
            case Step.Answer(GrantOutcome outcome) -> outcome;
            case Step.Probe(ProbeOutcome outcome) -> outcome;
            case Step.Fail(Throwable failure) -> {
                if (failure instanceof Error error) {
                    throw error;
                }
                throw (RuntimeException) failure;
            }
            case Step.FailWithCode(Function<String, RuntimeException> failure) -> throw failure.apply(code);
            case Step.Hang() -> {
                try {
                    Thread.sleep(Duration.ofMinutes(5));
                } catch (InterruptedException abandoned) {
                    Thread.currentThread().interrupt();
                }
                throw new IllegalStateException("abandoned");
            }
            case Step.Stubborn() -> {
                CountDownLatch release = stubbornRelease;
                boolean released = false;
                while (!released) {
                    try {
                        released = release.await(1, TimeUnit.MINUTES);
                    } catch (InterruptedException ignored) {
                        released = false;
                    }
                }
                throw new IllegalStateException("released");
            }
            case Step.Then(Runnable action, Step next) -> {
                action.run();
                yield execute(next, code);
            }
        };
    }

    @TestConfiguration(proxyBeanMethods = false)
    public static class Configuration {

        @Bean
        @Primary
        ScriptedAccessControl scriptedAccessControl() {
            return new ScriptedAccessControl();
        }
    }
}
