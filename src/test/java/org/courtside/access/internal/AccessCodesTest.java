package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.PostgresDiagnostics;
import org.courtside.config.AccessCodeLength;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.random.RandomGenerator;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(SettablePassClock.Configuration.class)
class AccessCodesTest extends AbstractIntegrationTest {

    private static final AccessCodeLength FOUR_DIGITS = new AccessCodeLength(4);
    private static final Duration UNTIL_CONTENTION = Duration.ofSeconds(20);

    @Autowired
    private AccessCodes codes;

    @Autowired
    private SettablePassClock clock;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    @Test
    void givenTwoDrawsRacingForTheSameCode_whenTheFirstCommits_thenTheSecondRedrawsAndBothHoldDifferentCodes()
            throws Exception {
        // given
        UUID first = insertGrant();
        UUID second = insertGrant();
        AccessCodes firstDraw = new AccessCodes(jdbc, digits("1234"));
        AccessCodes secondDraw = new AccessCodes(jdbc, digits("1234", "5678"));
        CountDownLatch firstHasInserted = new CountDownLatch(1);
        Callable<String> drawAndHoldUncommitted = () -> new TransactionTemplate(transactions).execute(status -> {
            String code = firstDraw.draw(first, FOUR_DIGITS);
            firstHasInserted.countDown();
            awaitASessionBlockedOnALock();
            return code;
        });
        Callable<String> drawTheSameCode = () -> {
            await(firstHasInserted);
            return new TransactionTemplate(transactions).execute(status -> secondDraw.draw(second, FOUR_DIGITS));
        };

        // when
        List<String> drawn;
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            List<Future<String>> futures = List.of(pool.submit(drawAndHoldUncommitted), pool.submit(drawTheSameCode));
            drawn = List.of(
                    PostgresDiagnostics.await(futures.get(0), UNTIL_CONTENTION, jdbc, "First draw"),
                    PostgresDiagnostics.await(futures.get(1), UNTIL_CONTENTION, jdbc, "Second draw"));
        }

        // then
        assertThat(drawn).as("the draw that lost the race on the primary key draws again").containsExactly("1234", "5678");
        assertThat(codesByGrant()).containsExactlyInAnyOrderEntriesOf(Map.of(first, "1234", second, "5678"));
    }

    @Test
    void givenACodeHeldAfterItsGrantLetGo_whenADrawHitsIt_thenAnotherCodeIsDrawn() {
        // given
        jdbc.sql("INSERT INTO access_code (code, until) VALUES ('1234', ?)")
                .params(Timestamp.from(clock.now().plus(Duration.ofHours(1)))).update();
        UUID grant = insertGrant();

        // when
        String code = new AccessCodes(jdbc, digits("1234", "9876")).draw(grant, FOUR_DIGITS);

        // then
        assertThat(code).as("a held code may still open a door").isEqualTo("9876");
        assertThat(codesByGrant()).containsExactlyEntriesOf(Map.of(grant, "9876"));
    }

    @Test
    void givenAnAccessPointsStaticCode_whenADrawHitsIt_thenAnotherCodeIsDrawn() {
        // given
        jdbc.sql("INSERT INTO access_point (id, name, static_code) VALUES (?, 'Clubhouse door', '1234')")
                .params(UUID.randomUUID()).update();
        UUID grant = insertGrant();

        // when
        String code = new AccessCodes(jdbc, digits("1234", "5678")).draw(grant, FOUR_DIGITS);

        // then
        assertThat(code).as("a static code is known to every member, so it never becomes one booking's code")
                .isEqualTo("5678");
        assertThat(codesByGrant()).containsExactlyEntriesOf(Map.of(grant, "5678"));
    }

    @Test
    void givenAnAccessPointsEmergencyCode_whenADrawHitsIt_thenAnotherCodeIsDrawn() {
        // given
        jdbc.sql("INSERT INTO access_point (id, name, emergency_code) VALUES (?, 'North gate', '1234')")
                .params(UUID.randomUUID()).update();
        UUID grant = insertGrant();

        // when
        String code = new AccessCodes(jdbc, digits("1234", "5678")).draw(grant, FOUR_DIGITS);

        // then
        assertThat(code).as("an emergency code stays on the keypad for everybody who asked, so no booking draws it")
                .isEqualTo("5678");
        assertThat(codesByGrant()).containsExactlyEntriesOf(Map.of(grant, "5678"));
    }

    @Test
    void givenEveryCandidateIsTaken_whenDrawing_thenTheDrawGivesUpAfterItsBound() {
        // given
        jdbc.sql("INSERT INTO access_code (code) VALUES ('1234')").update();
        UUID grant = insertGrant();
        String[] alwaysTaken = new String[AccessCodes.DRAWS + 1];
        Arrays.fill(alwaysTaken, "1234");
        alwaysTaken[AccessCodes.DRAWS] = "5678";
        AccessCodes drawing = new AccessCodes(jdbc, digits(alwaysTaken));

        // when / then
        assertThatThrownBy(() -> drawing.draw(grant, FOUR_DIGITS))
                .isInstanceOf(NoFreeAccessCodeException.class)
                .hasMessage("No free access code of 4 digits after " + AccessCodes.DRAWS + " draws");
        assertThat(codesByGrant()).as("a draw that gave up holds nothing").isEmpty();
    }

    @Test
    void givenTheClubsCodeLength_whenTheApplicationDraws_thenTheCodeHasExactlyThatManyDigits() {
        // given
        UUID grant = insertGrant();
        AccessCodeLength eight = new AccessCodeLength(8);

        // when
        String code = codes.draw(grant, eight);

        // then
        assertThat(eight.fits(code)).as("the drawn code %s fits the club's length", code).isTrue();
        assertThat(codesByGrant()).containsExactlyEntriesOf(Map.of(grant, code));
    }

    @Test
    void givenACodeDetachedUntilItsExposureEnds_whenExpiredCodesAreDeleted_thenItIsHeldUntilThatMomentOnly() {
        // given
        UUID grant = insertGrant();
        String code = new AccessCodes(jdbc, digits("4711")).draw(grant, FOUR_DIGITS);
        Instant exposedUntil = clock.now().plus(Duration.ofMinutes(30));
        codes.detach(grant, exposedUntil);
        clock.set(exposedUntil.minusSeconds(1));

        // when
        int beforeTheEnd = codes.deleteExpired(clock.now());
        clock.set(exposedUntil);
        int atTheEnd = codes.deleteExpired(clock.now());

        // then
        assertThat(beforeTheEnd).as("a door may accept the code until the exposure ends").isZero();
        assertThat(atTheEnd).isOne();
        assertThat(jdbc.sql("SELECT count(*) FROM access_code WHERE code = ?").params(code).query(Integer.class)
                .single()).isZero();
    }

    @Test
    void givenACodeThatWasNeverExposed_whenItIsDetached_thenTheNextDeletionRemovesItButKeepsCurrentCodes() {
        // given
        UUID released = insertGrant();
        UUID current = insertGrant();
        new AccessCodes(jdbc, digits("1111")).draw(released, FOUR_DIGITS);
        new AccessCodes(jdbc, digits("2222")).draw(current, FOUR_DIGITS);
        codes.detach(released, null);

        // when
        int deleted = codes.deleteExpired(clock.now());

        // then
        assertThat(deleted).isOne();
        assertThat(jdbc.sql("SELECT code FROM access_code").query(String.class).list())
                .as("a grant's current code is never deleted, whatever the time")
                .containsExactly("2222");
        assertThat(codesByGrant()).containsExactlyEntriesOf(Map.of(current, "2222"));
    }

    private UUID insertGrant() {
        UUID grant = UUID.randomUUID();
        jdbc.sql("INSERT INTO access_grant (id, booking_id) VALUES (?, ?)").params(grant, UUID.randomUUID()).update();
        return grant;
    }

    private Map<UUID, String> codesByGrant() {
        return jdbc.sql("SELECT grant_id, code FROM access_code WHERE grant_id IS NOT NULL")
                .query((row, index) -> Map.entry(row.getObject(1, UUID.class), row.getString(2)))
                .list().stream().collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    private void awaitASessionBlockedOnALock() {
        long deadline = System.nanoTime() + UNTIL_CONTENTION.toNanos();
        while (System.nanoTime() < deadline) {
            jdbc.sql("SELECT pg_stat_clear_snapshot()").query().singleValue();
            int blocked = jdbc.sql("""
                            SELECT count(*) FROM pg_stat_activity
                            WHERE datname = current_database() AND pid <> pg_backend_pid()
                              AND state = 'active' AND wait_event_type = 'Lock'
                            """).query(Integer.class).single();
            if (blocked > 0) {
                return;
            }
            sleepBriefly();
        }
        throw new AssertionError("The second draw never waited on the first one's code. "
                + PostgresDiagnostics.waitsAndLocks(jdbc));
    }

    private static void sleepBriefly() {
        try {
            Thread.sleep(20);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(failure);
        }
    }

    private static void await(CountDownLatch latch) throws InterruptedException {
        if (!latch.await(20, TimeUnit.SECONDS)) {
            throw new AssertionError("The first draw did not insert its code");
        }
    }

    private static RandomGenerator digits(String... candidates) {
        Deque<Integer> queue = new ArrayDeque<>();
        for (String candidate : candidates) {
            candidate.chars().forEach(digit -> queue.add(digit - '0'));
        }
        return new RandomGenerator() {
            @Override
            public long nextLong() {
                throw new AssertionError("a code is drawn digit by digit");
            }

            @Override
            public int nextInt(int bound) {
                assertThat(bound).isEqualTo(10);
                assertThat(queue).as("the scripted digits ran out").isNotEmpty();
                return queue.removeFirst();
            }
        };
    }
}
