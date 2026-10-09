package org.courtside.shared.internal;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.courtside.shared.WarmUpStep;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.sql.SQLException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class StartupWarmUpTest {

    private static final WarmUpProperties ENABLED = new WarmUpProperties(true, Duration.ofSeconds(10));

    private final Logger logger = (Logger) LoggerFactory.getLogger(StartupWarmUp.class);
    private final ListAppender<ILoggingEvent> logged = new ListAppender<>();

    @BeforeEach
    void attachAppender() {
        logged.start();
        logger.addAppender(logged);
    }

    @AfterEach
    void detachAppender() {
        logger.detachAppender(logged);
    }

    @Test
    void givenStepsThatSucceed_whenTheWarmUpRuns_thenEachRunsEveryRoundAndOneInfoLineNamesThem() {
        // given
        CountingStep reads = new CountingStep("public-reads", true);
        CountingStep writes = new CountingStep("booking-write", true);

        // when
        StartupWarmUp.Report report = new StartupWarmUp(List.of(reads, writes), ENABLED).run();

        // then
        assertThat(reads.runs.get())
                .as("a step that succeeds must run in every round")
                .isEqualTo(StartupWarmUp.ROUNDS);
        assertThat(report.ran())
                .as("the report must name every step that ran")
                .containsExactly("public-reads", "booking-write");
        assertThat(report.completed())
                .as("a warm-up that ran every round must report completion")
                .isTrue();
        assertThat(logged.list)
                .as("one INFO line must report the duration and the steps that ran")
                .singleElement()
                .satisfies(event -> {
                    assertThat(event.getLevel()).isEqualTo(Level.INFO);
                    assertThat(event.getFormattedMessage()).contains("public-reads", "booking-write", " ms");
                });
    }

    @Test
    void givenAFailingStep_whenTheWarmUpRuns_thenItWarnsWithTheCauseTypesOnceAndTheOthersStillRun() {
        // given
        WarmUpStep failing = new WarmUpStep() {
            @Override
            public String name() {
                return "series-preview";
            }

            @Override
            public boolean run() {
                throw new IllegalStateException("Jane Doe could not be read",
                        new SQLException("relation does not exist"));
            }
        };
        CountingStep later = new CountingStep("password-verification", true);

        // when
        StartupWarmUp.Report report = new StartupWarmUp(List.of(failing, later), ENABLED).run();

        // then
        assertThat(report.failed())
                .as("the report must name the failing step")
                .containsExactly("series-preview");
        assertThat(later.runs.get())
                .as("a step after a failing one must still run every round")
                .isEqualTo(StartupWarmUp.ROUNDS);
        assertThat(logged.list.stream().filter(event -> event.getLevel() == Level.WARN).toList())
                .as("a failing step must be warned about once, with its cause types and without its message")
                .singleElement()
                .satisfies(event -> assertThat(event.getFormattedMessage())
                        .contains("series-preview", "IllegalStateException <- SQLException")
                        .doesNotContain("Jane Doe"));
    }

    @Test
    void givenAStepWithNothingToExercise_whenTheWarmUpRuns_thenItIsReportedSkippedAndNotRepeated() {
        // given
        CountingStep empty = new CountingStep("booking-write", false);

        // when
        StartupWarmUp.Report report = new StartupWarmUp(List.of(empty), ENABLED).run();

        // then
        assertThat(empty.runs.get())
                .as("a step with nothing to exercise must not be asked again")
                .isEqualTo(1);
        assertThat(report.skipped())
                .as("the report must name the skipped step")
                .containsExactly("booking-write");
        assertThat(logged.list)
                .as("a skipped step is not a failure")
                .noneMatch(event -> event.getLevel() == Level.WARN);
    }

    @Test
    void givenAStepThatOutlastsTheDeadline_whenTheWarmUpRuns_thenItReturnsAtTheDeadlineAndInterruptsTheStep()
            throws Exception {
        // given
        CountDownLatch interrupted = new CountDownLatch(1);
        WarmUpStep hanging = new WarmUpStep() {
            @Override
            public String name() {
                return "public-reads";
            }

            @Override
            public boolean run() {
                try {
                    new CountDownLatch(1).await();
                } catch (InterruptedException expected) {
                    interrupted.countDown();
                }
                return true;
            }
        };
        StartupWarmUp warmUp = new StartupWarmUp(List.of(hanging),
                new WarmUpProperties(true, Duration.ofMillis(300)));

        // when
        long started = System.nanoTime();
        StartupWarmUp.Report report = warmUp.run();
        Duration took = Duration.ofNanos(System.nanoTime() - started);

        // then
        assertThat(took)
                .as("the warm-up must return once its deadline has passed")
                .isLessThan(Duration.ofSeconds(5));
        assertThat(report.completed())
                .as("a warm-up stopped at its deadline must not report completion")
                .isFalse();
        assertThat(interrupted.await(5, TimeUnit.SECONDS))
                .as("the step still running at the deadline must be interrupted")
                .isTrue();
        assertThat(logged.list)
                .as("a deadline that stops the warm-up must be warned about")
                .anyMatch(event -> event.getLevel() == Level.WARN
                        && event.getFormattedMessage().contains("deadline"));
    }

    @Test
    void givenTheWarmUpDisabled_whenTheInstanceIsReady_thenNoStepRuns() {
        // given
        CountingStep reads = new CountingStep("public-reads", true);
        StartupWarmUp warmUp = new StartupWarmUp(List.of(reads), new WarmUpProperties(false, Duration.ofSeconds(10)));

        // when
        warmUp.beforeReadiness();

        // then
        assertThat(reads.runs.get())
                .as("a disabled warm-up must not run any step")
                .isZero();
    }

    private static final class CountingStep implements WarmUpStep {

        private final String name;
        private final boolean exercised;
        private final AtomicInteger runs = new AtomicInteger();

        private CountingStep(String name, boolean exercised) {
            this.name = name;
            this.exercised = exercised;
        }

        @Override
        public String name() {
            return name;
        }

        @Override
        public boolean run() {
            runs.incrementAndGet();
            return exercised;
        }
    }
}
