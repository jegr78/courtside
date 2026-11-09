package org.courtside.payment.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiPayPalRefund;
import org.courtside.api.ApiPayPalRefundBlock;
import org.courtside.api.ApiPayPalRefundOption;
import org.courtside.api.ApiPayPalRefundOptions;
import org.courtside.api.ApiPayPalRefundRequest;
import org.courtside.api.ApiPayPalRefundStatus;
import org.courtside.api.PaymentRefundApi;
import org.courtside.payment.internal.PayPalRefunds;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
class PayPalRefundController implements PaymentRefundApi {

    private final PayPalRefunds refunds;

    @Override
    public ResponseEntity<ApiPayPalRefund> refundPayPalPayment(ApiPayPalRefundRequest request) {
        PayPalRefunds.RefundView refund = refunds.refund(request.getOrderId());
        return ResponseEntity.ok(new ApiPayPalRefund(refund.orderId(),
                ApiPayPalRefundStatus.fromValue(refund.status().name())).failureReason(refund.failureReason()));
    }

    @Override
    public ResponseEntity<ApiPayPalRefundOptions> listPayPalRefunds(UUID accountId) {
        return ResponseEntity.ok(new ApiPayPalRefundOptions(refunds.ofAccount(accountId).stream()
                .map(PayPalRefundController::option).toList()));
    }

    private static ApiPayPalRefundOption option(PayPalRefunds.RefundOption option) {
        return new ApiPayPalRefundOption(option.orderId(), option.refundable())
                .status(option.status() == null ? null : ApiPayPalRefundStatus.fromValue(option.status().name()))
                .failureReason(option.failureReason())
                .blockedBy(option.blockedBy() == null ? null : ApiPayPalRefundBlock.fromValue(option.blockedBy()));
    }
}
