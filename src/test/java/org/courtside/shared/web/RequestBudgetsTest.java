package org.courtside.shared.web;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

class RequestBudgetsTest {

    private final AtomicLong now = new AtomicLong();

    private RequestBudgets budgets(int trackedPrincipals) {
        return new RequestBudgets(trackedPrincipals, now::get);
    }

    @Test
    void givenAFullBudget_whenSpendingItsBurst_thenEveryRequestIsAdmittedAndTheNextIsRefused() {
        // given
        RequestBudgets budgets = budgets(10);
        RequestBudget budget = new RequestBudget(10, 5);

        // when
        boolean burstAdmitted = true;
        for (int request = 0; request < 5; request++) {
            burstAdmitted &= budgets.spend("account:jane", budget, 2).isEmpty();
        }

        // then
        assertThat(burstAdmitted).as("ten tokens admit five requests of cost two").isTrue();
        assertThat(budgets.spend("account:jane", budget, 2).map(RequestBudgets.Refusal::retryAfter))
                .as("the sixth request finds the budget spent and is told when two tokens are back")
                .contains(Duration.ofMillis(400));
    }

    @Test
    void givenASpentBudget_whenTimePasses_thenItRefillsAtItsRateUpToItsBurst() {
        // given
        RequestBudgets budgets = budgets(10);
        RequestBudget budget = new RequestBudget(10, 5);
        budgets.spend("account:jane", budget, 10);

        // when
        now.addAndGet(Duration.ofSeconds(1).toNanos());

        // then
        assertThat(budgets.spend("account:jane", budget, 5)).as("one second refills five tokens").isEmpty();
        assertThat(budgets.spend("account:jane", budget, 1)).as("and not one more").isPresent();
        now.addAndGet(Duration.ofHours(1).toNanos());
        assertThat(budgets.spend("account:jane", budget, 10)).as("an idle budget refills to its burst").isEmpty();
        assertThat(budgets.spend("account:jane", budget, 1)).as("but never beyond it").isPresent();
    }

    @Test
    void givenOnePrincipalSpentItsBudget_whenAnotherRequests_thenTheOtherIsAdmitted() {
        // given
        RequestBudgets budgets = budgets(10);
        RequestBudget budget = new RequestBudget(1, 1);
        budgets.spend("account:jane", budget, 1);

        // when / then
        assertThat(budgets.spend("account:jane", budget, 1)).isPresent();
        assertThat(budgets.spend("account:john", budget, 1)).as("budgets are per principal").isEmpty();
    }

    @Test
    void givenMorePrincipalsThanTracked_whenANewOneRequests_thenTheLeastRecentlySeenIsForgotten() {
        // given
        RequestBudgets budgets = budgets(2);
        RequestBudget budget = new RequestBudget(1, 1);
        budgets.spend("account:jane", budget, 1);
        budgets.spend("account:john", budget, 1);

        // when
        budgets.spend("account:mary", budget, 1);

        // then
        assertThat(budgets.tracked()).as("memory stays bounded by the tracked principals").isEqualTo(2);
        assertThat(budgets.spend("account:john", budget, 1)).as("a recently seen budget is kept").isPresent();
        assertThat(budgets.spend("account:jane", budget, 1)).as("the oldest starts again full").isEmpty();
    }

    @Test
    void givenARefusingBudget_whenRefusedAgain_thenOnlyTheFirstRefusalOfThatStretchIsMarkedFirst() {
        // given
        RequestBudgets budgets = budgets(10);
        RequestBudget budget = new RequestBudget(1, 1);
        budgets.spend("account:jane", budget, 1);

        // when
        boolean first = budgets.spend("account:jane", budget, 1).orElseThrow().first();
        boolean repeated = budgets.spend("account:jane", budget, 1).orElseThrow().first();
        now.addAndGet(Duration.ofSeconds(1).toNanos());
        budgets.spend("account:jane", budget, 1);
        boolean afterRecovery = budgets.spend("account:jane", budget, 1).orElseThrow().first();

        // then
        assertThat(first).as("the change from admitting to refusing is reported").isTrue();
        assertThat(repeated).as("a continuing refusal is not reported again").isFalse();
        assertThat(afterRecovery).as("a new stretch after an admitted request is reported again").isTrue();
    }
}
