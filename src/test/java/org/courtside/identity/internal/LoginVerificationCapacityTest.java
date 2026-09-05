package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class LoginVerificationCapacityTest {

    @Test
    void givenEveryPermitIsOccupied_whenAnotherVerificationArrives_thenItIsRefusedUntilOneEnds() {
        // given
        LoginVerificationCapacity capacity = new LoginVerificationCapacity(propertiesWithCapacity(1));
        LoginVerificationCapacity.Permit occupied = capacity.tryAcquire().orElseThrow();

        // when / then
        assertThat(capacity.tryAcquire()).isEmpty();
        occupied.close();
        assertThat(capacity.tryAcquire()).isPresent().get().satisfies(LoginVerificationCapacity.Permit::close);
    }

    @Test
    void givenAPermitIsClosedTwice_whenTwoCallersFollow_thenOnlyOneCanEnter() {
        // given
        LoginVerificationCapacity capacity = new LoginVerificationCapacity(propertiesWithCapacity(1));
        LoginVerificationCapacity.Permit permit = capacity.tryAcquire().orElseThrow();

        // when
        permit.close();
        permit.close();

        // then
        assertThat(capacity.tryAcquire()).isPresent();
        assertThat(capacity.tryAcquire()).isEmpty();
    }

    @Test
    void givenManyCallersRaceForTwoSlots_whenTheyAcquireTogether_thenOnlyTwoEnter()
            throws Exception {
        // given
        LoginVerificationCapacity capacity = new LoginVerificationCapacity(propertiesWithCapacity(2));
        CountDownLatch start = new CountDownLatch(1);

        // when
        List<Optional<LoginVerificationCapacity.Permit>> results;
        try (var executor = Executors.newFixedThreadPool(12)) {
            var futures = java.util.stream.IntStream.range(0, 12)
                    .mapToObj(ignored -> executor.submit(() -> {
                        start.await();
                        return capacity.tryAcquire();
                    }))
                    .toList();
            start.countDown();
            results = futures.stream().map(future -> {
                try {
                    return future.get(5, TimeUnit.SECONDS);
                } catch (Exception exception) {
                    throw new IllegalStateException("Capacity race did not finish", exception);
                }
            }).toList();
        }

        // then
        assertThat(results).filteredOn(Optional::isPresent).hasSize(2)
                .allSatisfy(result -> result.orElseThrow().close());
    }

    private static LoginProtectionProperties propertiesWithCapacity(int capacity) {
        return new LoginProtectionProperties(
                new LoginProtectionProperties.Limit(20, Duration.ofMinutes(1), Duration.ofMinutes(1)),
                new LoginProtectionProperties.Observation(100, Duration.ofMinutes(1)), capacity);
    }
}
