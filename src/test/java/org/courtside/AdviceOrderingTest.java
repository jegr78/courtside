package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.AnnotationAwareOrderComparator;
import org.springframework.core.annotation.Order;
import org.springframework.web.bind.annotation.ControllerAdvice;

import java.util.Collection;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AdviceOrderingTest extends AbstractIntegrationTest {

    private static final String SHARED_ADVICE_SIMPLE_NAME = "SharedExceptionHandler";
    private static final String OWNED_PACKAGE_PREFIX = "org.courtside";

    @Autowired
    private ApplicationContext context;

    @Test
    void givenProjectControllerAdvices_whenCheckingTheirOrder_thenEveryAdviceSortsAheadOfTheSharedFallback() {
        // given
        Map<String, Object> advices = context.getBeansWithAnnotation(ControllerAdvice.class);
        Object sharedAdvice = advices.values().stream()
                .filter(advice -> advice.getClass().getSimpleName().equals(SHARED_ADVICE_SIMPLE_NAME))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        SHARED_ADVICE_SIMPLE_NAME + " is not registered"));
        int sharedOrder = AnnotationAwareOrderComparator.INSTANCE.getOrder(sharedAdvice, null);
        List<Object> projectAdvices = advices.values().stream()
                .filter(advice -> advice != sharedAdvice)
                .filter(advice -> advice.getClass().getPackageName().startsWith(OWNED_PACKAGE_PREFIX))
                .toList();

        // when / then
        assertDistinctOrders(projectAdvices);
        projectAdvices.forEach(advice -> {
            int order = AnnotationAwareOrderComparator.INSTANCE.getOrder(advice, null);
            assertThat(order)
                    .as("%s must declare @Order(value) with value < %d (%s's order), or its "
                                    + "handlers can be pre-empted by %s's cause-chain fallback",
                            advice.getClass().getSimpleName(), sharedOrder,
                            SHARED_ADVICE_SIMPLE_NAME, SHARED_ADVICE_SIMPLE_NAME)
                    .isLessThan(sharedOrder);
        });
    }

    @Test
    void givenDuplicateAdviceOrders_whenCheckingTheirOrder_thenTheDuplicatesAreRejected() {
        // given
        Collection<Object> advices = List.of(new FirstTestAdvice(), new SecondTestAdvice());

        // when / then
        assertThatThrownBy(() -> assertDistinctOrders(advices))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("duplicate");
    }

    private static void assertDistinctOrders(Collection<Object> advices) {
        assertThat(advices)
                .extracting(advice -> AnnotationAwareOrderComparator.INSTANCE.getOrder(advice, null))
                .as("advice orders must not contain duplicates")
                .doesNotHaveDuplicates();
    }

    @Order(10)
    private static final class FirstTestAdvice {
    }

    @Order(10)
    private static final class SecondTestAdvice {
    }
}
