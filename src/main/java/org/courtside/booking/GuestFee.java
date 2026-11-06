package org.courtside.booking;

import java.util.Currency;

public record GuestFee(int minor, Currency currency) {

    public GuestFee {
        if (minor < 0 || currency == null) {
            throw new IllegalArgumentException("A guest fee is a non-negative amount in a currency");
        }
    }
}
