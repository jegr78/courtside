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
        return ResponseEntity.ok(capture(checkout.capture(orderId)));
    }

    @Override
    public ResponseEntity<ApiPayPalCapture> cancelPayPalOrder(String orderId) {
        return ResponseEntity.ok(capture(checkout.cancel(orderId)));
    }

    private static ApiPayPalCapture capture(PayPalCheckout.Settlement settlement) {
        return new ApiPayPalCapture(settlement.bookingId(),
                ApiPayPalCaptureOutcome.fromValue(settlement.outcome().name()));
    }
}
