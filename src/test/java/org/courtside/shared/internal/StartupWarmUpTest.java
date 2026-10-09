package org.courtside.shared.internal;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.courtside.shared.WarmUpStep;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.http.HttpStatus;

import java.sql.SQLException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class StartupWarmUpTest {

    private static final WarmUpProperties ENABLED = new WarmUpProperties(true, 7, Duration.ofSeconds(10));

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
                .isEqualTo(ENABLED.rounds());
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
                .isEqualTo(ENABLED.rounds());
        assertThat(logged.list.stream().filter(event -> event.getLevel() == Level.WARN).toList())
                .as("a failing step must be warned about once, with its cause types and without its message")
                .singleElement()
                .satisfies(event -> assertThat(event.getFormattedMessage())
                        .contains("series-preview", "IllegalStateException <- SQLException")
                        .doesNotContain("Jane Doe"));
    }

    @Test
    void givenAStepRefusedByTheDomain_whenTheWarmUpRuns_thenTheWarningNamesTheProblemTypeAndViolationCode() {
        // given
        WarmUpStep refused = new WarmUpStep() {
            @Override
            public String name() {
                return "booking-write";
            }

            @Override
            public boolean run() {
                throw new RefusedSlot();
            }
        };

        // when
        new StartupWarmUp(List.of(refused), ENABLED).run();

        // then
        assertThat(logged.list.stream().filter(event -> event.getLevel() == Level.WARN).toList())
                .as("a domain refusal must be diagnosable from its problem type and violation code alone")
                .singleElement()
                .satisfies(event -> assertThat(event.getFormattedMessage())
                        .contains("booking-write", "urn:courtside:error:slot-refused", "booking.rule.slotGrid")
                        .doesNotContain("Example Tennis Club"));
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
                    new CountDownLatch(1).await(10, TimeUnit.SECONDS);
                } catch (InterruptedException expected) {
                    interrupted.countDown();
                }
                return true;
            }
        };
        StartupWarmUp warmUp = new StartupWarmUp(List.of(hanging),
                new WarmUpProperties(true, 7, Duration.ofMillis(300)));

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
    void givenAStepThatRanAndThenHasNothingLeft_whenTheWarmUpRuns_thenItCountsAsRunAndStops() {
        // given
        java.util.concurrent.atomic.AtomicInteger runs = new java.util.concurrent.atomic.AtomicInteger();
        org.courtside.shared.WarmUpStep reads = new org.courtside.shared.WarmUpStep() {
            @Override
            public String name() {
                return "public-reads";
            }

            @Override
            public boolean run() {
                return runs.incrementAndGet() <= 3;
            }
        };

        // when
        StartupWarmUp.Report report = new StartupWarmUp(List.of(reads), ENABLED).run();

        // then
        assertThat(runs.get())
                .as("a step that reports nothing left must not be asked again")
                .isEqualTo(4);
        assertThat(report.ran())
                .as("a step that ran before it ran out still ran")
                .containsExactly("public-reads");
        assertThat(report.skipped())
                .as("running out after running is not a skip")
                .isEmpty();
    }

    @Test
    void givenAStepWithASmallerRoundBudget_whenTheWarmUpRuns_thenItStopsThereWhileTheOthersRunEveryRound() {
        // given
        CountingStep reads = new CountingStep("public-reads", true);
        CountingStep writes = new CountingStep("booking-write", true, 2);

        // when
        StartupWarmUp.Report report = new StartupWarmUp(List.of(reads, writes), ENABLED).run();

        // then
        assertThat(writes.runs.get())
                .as("a step must not run more rounds than its own budget")
                .isEqualTo(2);
        assertThat(reads.runs.get())
                .as("a step without a budget of its own must run every configured round")
                .isEqualTo(ENABLED.rounds());
        assertThat(report.ran())
                .as("a step that used up its budget still ran")
                .containsExactly("public-reads", "booking-write");
    }

    @Test
    void givenAStepThatIgnoresTheInterrupt_whenItFinishesAfterTheDeadline_thenNoFurtherRoundStarts()
            throws Exception {
        // given
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch secondStart = new CountDownLatch(2);
        WarmUpStep stubborn = new WarmUpStep() {
            @Override
            public String name() {
                return "booking-write";
            }

            @Override
            public boolean run() {
                secondStart.countDown();
                boolean released = false;
                while (!released) {
                    try {
                        released = release.await(5, TimeUnit.SECONDS);
                    } catch (InterruptedException ignored) {
                        Thread.interrupted();
                    }
                }
                return true;
            }
        };
        StartupWarmUp warmUp = new StartupWarmUp(List.of(stubborn),
                new WarmUpProperties(true, 7, Duration.ofMillis(200)));

        // when
        StartupWarmUp.Report report = warmUp.run();
        release.countDown();

        // then
        assertThat(report.completed())
                .as("a warm-up stopped at its deadline must not report completion")
                .isFalse();
        assertThat(secondStart.await(1, TimeUnit.SECONDS))
                .as("a step still running at the deadline must not be followed by another round")
                .isFalse();
    }

    @Test
    void givenTheWarmUpDisabled_whenTheInstanceIsReady_thenNoStepRuns() {
        // given
        CountingStep reads = new CountingStep("public-reads", true);
        StartupWarmUp warmUp = new StartupWarmUp(List.of(reads), new WarmUpProperties(false, 7, Duration.ofSeconds(10)));

        // when
        warmUp.beforeReadiness(mock(ApplicationReadyEvent.class));

        // then
        assertThat(reads.runs.get())
                .as("a disabled warm-up must not run any step")
                .isZero();
    }

    private static final class RefusedSlot extends CodedDomainFailure {

        private RefusedSlot() {
            super("booking.rule.slotGrid", Map.of("club", "Example Tennis Club"));
        }

        @Override
        public ProblemType problemType() {
            return new ProblemType("slot-refused", HttpStatus.UNPROCESSABLE_ENTITY, "Slot refused",
                    "The slot is not on the grid");
        }
    }

    private static final class CountingStep implements WarmUpStep {

        private final String name;
        private final boolean exercised;
        private final int roundBudget;
        private final AtomicInteger runs = new AtomicInteger();

        private CountingStep(String name, boolean exercised) {
            this(name, exercised, Integer.MAX_VALUE);
        }

        private CountingStep(String name, boolean exercised, int roundBudget) {
            this.name = name;
            this.exercised = exercised;
            this.roundBudget = roundBudget;
        }

        @Override
        public int roundBudget() {
            return roundBudget;
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
