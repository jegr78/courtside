package org.courtside.identity;

import java.util.UUID;

public record AccountAddressChanged(UUID accountId, String previousAddress) {
}
