package org.courtside.booking.internal;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.util.Map;

public class BookingExtensionRefusedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "booking-extension-refused", HttpStatus.CONFLICT,
            "Booking extension refused", "This booking cannot be extended to the requested end");

    private BookingExtensionRefusedException(String code, Map<String, Object> params, Throwable cause) {
        super(code, params, cause);
    }

    public static BookingExtensionRefusedException stale(Instant endsAt) {
        return new BookingExtensionRefusedException("booking.extension.stale", Map.of("endsAt", endsAt.toString()),
                null);
    }

    public static BookingExtensionRefusedException courtTaken(Throwable cause) {
        return new BookingExtensionRefusedException("booking.extension.courtTaken", Map.of(), cause);
    }

    public static BookingExtensionRefusedException charged() {
        return new BookingExtensionRefusedException("booking.extension.charged", Map.of(), null);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
