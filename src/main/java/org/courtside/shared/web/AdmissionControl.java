package org.courtside.shared.web;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.courtside.shared.SecurityEventLog;
import org.courtside.shared.SecurityEventPrincipal;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

class AdmissionControl implements HandlerInterceptor {

    private static final String PERMIT = AdmissionControl.class.getName() + ".PERMIT";

    private final AdmissionPlan plan;
    private final RequestBudgets budgets;
    private final RequestBudget accountBudget;
    private final RequestBudget addressBudget;
    private final Duration bulkheadWait;
    private final SecurityEventLog securityEvents;

    AdmissionControl(AdmissionPlan plan, RequestBudgets budgets, AdmissionProperties properties,
                     SecurityEventLog securityEvents) {
        this.plan = plan;
        this.budgets = budgets;
        this.accountBudget = properties.account().budget();
        this.addressBudget = properties.address().budget();
        this.bulkheadWait = properties.bulkheadWait();
        this.securityEvents = securityEvents;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (request.getDispatcherType() != DispatcherType.REQUEST || HttpMethod.OPTIONS.matches(request.getMethod())
                || !(handler instanceof HandlerMethod method)) {
            return true;
        }
        AdmissionPlan.Admission admission = plan.of(method.getMethod().getName());
        Optional<UUID> account = SecurityEventPrincipal.currentAccountId();
        String principal = account.map(id -> "account:" + id)
                .orElseGet(() -> "address:" + ClientAddress.bucketOf(request.getRemoteAddr()));
        RequestBudget budget = account.isPresent() ? accountBudget : addressBudget;
        budgets.spend(principal, budget, admission.cost()).ifPresent(refusal -> {
            if (refusal.first()) {
                securityEvents.controlTriggered(account.orElse(null), SecurityEventLog.ControlTrigger.REQUEST_BUDGET);
            }
            throw new RequestRateLimitedException(refusal.retryAfter());
        });
        if (admission.bulkhead().isPresent()) {
            Bulkhead bulkhead = admission.bulkhead().orElseThrow();
            if (!bulkhead.tryEnter(principal, bulkheadWait)) {
                budgets.refund(principal, budget, admission.cost());
                securityEvents.controlRefused(account.orElse(null), SecurityEventLog.ControlRefusal.OPERATION_CAPACITY);
                throw new OperationCapacityExhaustedException();
            }
            request.setAttribute(PERMIT, new Permit(bulkhead, principal));
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
                                @Nullable Exception failure) {
        if (request.getAttribute(PERMIT) instanceof Permit permit) {
            request.removeAttribute(PERMIT);
            permit.bulkhead().leave(permit.principal());
        }
    }

    private record Permit(Bulkhead bulkhead, String principal) {
    }
}
