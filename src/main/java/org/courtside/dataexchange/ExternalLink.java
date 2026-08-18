package org.courtside.dataexchange;

import java.time.Instant;
import java.util.UUID;

public record ExternalLink(UUID referenceId, UUID sourceId, String externalId, UUID personId,
                           Instant linkedAt) {
}
