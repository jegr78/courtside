package org.courtside.payment.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiPayPalConnectionCheckOutcome;
import org.courtside.api.ApiPayPalConnectionCheckResult;
import org.courtside.api.ApiPayPalEnvironment;
import org.courtside.api.ApiPayPalSettings;
import org.courtside.api.ApiPayPalSettingsRequest;
import org.courtside.api.PaymentApi;
import org.courtside.payment.PayPalEnvironment;
import org.courtside.payment.internal.PayPalConnectionCheck;
import org.courtside.payment.internal.PayPalSettingsService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.ZoneOffset;

@RestController
@RequiredArgsConstructor
class PayPalSettingsController implements PaymentApi {

    private final PayPalSettingsService service;

    @Override
    public ResponseEntity<ApiPayPalSettings> getPayPalSettings() {
        return ResponseEntity.ok(settings(service.settings()));
    }

    @Override
    public ResponseEntity<ApiPayPalSettings> savePayPalSettings(ApiPayPalSettingsRequest request) {
        return ResponseEntity.ok(settings(service.save(request.getClientId(),
                PayPalEnvironment.valueOf(request.getEnvironment().getValue()), request.getEnabled(),
                request.getSecret())));
    }

    @Override
    public ResponseEntity<Void> removePayPalCredentials() {
        service.remove();
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<ApiPayPalConnectionCheckResult> checkPayPalConnection() {
        PayPalConnectionCheck.Result result = service.check();
        return ResponseEntity.ok(new ApiPayPalConnectionCheckResult(
                ApiPayPalConnectionCheckOutcome.fromValue(result.outcome().name()))
                .providerReason(result.providerReason()));
    }

    private static ApiPayPalSettings settings(PayPalSettingsService.Settings settings) {
        return new ApiPayPalSettings(settings.clientId(), ApiPayPalEnvironment.fromValue(settings.environment().name()),
                settings.enabled(), settings.secretStoredAt() == null ? null
                : settings.secretStoredAt().atOffset(ZoneOffset.UTC));
    }
}
