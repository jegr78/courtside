package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.AnnotationAwareOrderComparator;
import org.springframework.web.bind.annotation.ControllerAdvice;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AdviceOrderingTest extends AbstractIntegrationTest {

    private static final String SHARED_ADVICE_SIMPLE_NAME = "SharedExceptionHandler";
    private static final String OWNED_PACKAGE_PREFIX = "org.courtside";

    @Autowired
    private ApplicationContext context;

    @Test
    void everyOtherControllerAdvice_sortsAheadOfTheSharedFallback() {
        // given
        Map<String, Object> advices = context.getBeansWithAnnotation(ControllerAdvice.class);
        Object sharedAdvice = advices.values().stream()
                .filter(advice -> advice.getClass().getSimpleName().equals(SHARED_ADVICE_SIMPLE_NAME))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        SHARED_ADVICE_SIMPLE_NAME + " is not registered"));
        int sharedOrder = AnnotationAwareOrderComparator.INSTANCE.getOrder(sharedAdvice, null);

        // when / then
        advices.values().stream()
                .filter(advice -> advice != sharedAdvice)
                .filter(advice -> advice.getClass().getPackageName().startsWith(OWNED_PACKAGE_PREFIX))
                .forEach(advice -> {
                    int order = AnnotationAwareOrderComparator.INSTANCE.getOrder(advice, null);
                    assertThat(order)
                            .as("%s must declare @Order(value) with value < %d (%s's order), or its "
                                            + "handlers can be pre-empted by %s's cause-chain fallback",
                                    advice.getClass().getSimpleName(), sharedOrder,
                                    SHARED_ADVICE_SIMPLE_NAME, SHARED_ADVICE_SIMPLE_NAME)
                            .isLessThan(sharedOrder);
                });
    }
}
