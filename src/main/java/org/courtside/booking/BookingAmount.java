package org.courtside.booking;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.Currency;

public record BookingAmount(int minor, Currency currency) {

    public BookingAmount {
        if (minor < 0 || currency == null) {
            throw new IllegalArgumentException("A booking amount is a non-negative amount in a currency");
        }
    }

    public static BookingAmount forDuration(int hourlyMinor, Duration duration, Currency currency) {
        BigDecimal minor = BigDecimal.valueOf(hourlyMinor).multiply(BigDecimal.valueOf(duration.toSeconds()))
                .divide(BigDecimal.valueOf(3600), 0, RoundingMode.HALF_UP);
        return new BookingAmount(minor.intValueExact(), currency);
    }
}
