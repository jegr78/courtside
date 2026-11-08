package org.courtside.payment.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiPayPalAvailability;
import org.courtside.api.ApiPayPalCapture;
import org.courtside.api.ApiPayPalCaptureOutcome;
import org.courtside.api.ApiPayPalOrder;
import org.courtside.api.ApiPayPalOrderRequest;
import org.courtside.api.PaymentCheckoutApi;
import org.courtside.payment.internal.PayPalCheckout;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class PayPalCheckoutController implements PaymentCheckoutApi {

    private final PayPalCheckout checkout;

    @Override
    public ResponseEntity<ApiPayPalAvailability> getPayPalAvailability() {
        return ResponseEntity.ok(new ApiPayPalAvailability(checkout.available()));
    }

    @Override
    public ResponseEntity<ApiPayPalOrder> createPayPalOrder(ApiPayPalOrderRequest request) {
        PayPalCheckout.CreatedOrder order = checkout.create(request.getBookingId());
        return ResponseEntity.ok(new ApiPayPalOrder(order.orderId(), order.approveUrl()));
    }

    @Override
    public ResponseEntity<ApiPayPalCapture> capturePayPalOrder(String orderId) {
        PayPalCheckout.Settlement settlement = checkout.capture(orderId);
        return ResponseEntity.ok(new ApiPayPalCapture(settlement.bookingId(),
                ApiPayPalCaptureOutcome.fromValue(settlement.outcome().name())));
    }

    @Override
    public ResponseEntity<Void> cancelPayPalOrder(String orderId) {
        checkout.cancel(orderId);
        return ResponseEntity.noContent().build();
    }
}
