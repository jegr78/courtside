package org.courtside.booking.web;

import org.courtside.api.ApiCancellationReason;
import org.courtside.shared.CancellationReason;

final class CancellationReasons {

    private CancellationReasons() {
    }

    static CancellationReason of(ApiCancellationReason reason) {
        return reason == null ? null : CancellationReason.valueOf(reason.getValue());
    }
}
