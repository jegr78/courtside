package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.interceptor.TransactionAttribute;
import org.springframework.transaction.interceptor.TransactionAttributeSource;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.assertj.core.api.Assertions.assertThat;

class ReportTransactionDeadlineTest extends AbstractIntegrationTest {

    private static final List<String> REPORT_PATHS = List.of(
            "org.courtside.reporting.internal.StatisticsService",
            "org.courtside.dataexchange.internal.RosterExportService",
            "org.courtside.dataexchange.internal.SubjectAccessService",
            "org.courtside.dataexchange.ExecutionService",
            "org.courtside.dataexchange.PreviewService",
            "org.courtside.booking.internal.FacilityUtilisationService");

    @Test
    void givenEveryReportPath_whenItsTransactionIsDeclared_thenItCarriesTheReportDeadline(
            @Autowired TransactionAttributeSource transactions) throws Exception {
        // given
        Map<String, Integer> timeouts = new TreeMap<>();

        // when
        for (String name : REPORT_PATHS) {
            Class<?> type = Class.forName(name);
            for (Method method : type.getDeclaredMethods()) {
                if (!Modifier.isPrivate(method.getModifiers()) && !method.isSynthetic()) {
                    TransactionAttribute attribute = transactions.getTransactionAttribute(method, type);
                    if (attribute != null) {
                        timeouts.put(type.getSimpleName() + "#" + method.getName(), attribute.getTimeout());
                    }
                }
            }
        }
        Method ledger = Class.forName("org.courtside.booking.internal.BookingLedgerService")
                .getMethod("confirmedBetween", java.time.LocalDate.class, java.time.LocalDate.class);
        timeouts.put("BookingLedgerService#confirmedBetween",
                transactions.getTransactionAttribute(ledger, ledger.getDeclaringClass()).getTimeout());

        // then
        assertThat(timeouts).as("every statistics, export, subject-access and import path states 120 seconds")
                .isNotEmpty()
                .allSatisfy((method, seconds) -> assertThat(seconds).as(method).isEqualTo(120));
    }
}
