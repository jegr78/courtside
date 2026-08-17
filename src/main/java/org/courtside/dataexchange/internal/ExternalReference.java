package org.courtside.dataexchange.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "import_external_reference")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ExternalReference {

    @Id
    private UUID id;

    @Column(name = "source_id", nullable = false)
    private UUID sourceId;

    @Column(name = "external_id", nullable = false)
    private String externalId;

    @Column(name = "person_id", nullable = false)
    private UUID personId;

    @Column(name = "linked_at", nullable = false)
    private Instant linkedAt;

    public ExternalReference(UUID sourceId, String externalId, UUID personId, Instant linkedAt) {
        this.id = UUID.randomUUID();
        this.sourceId = sourceId;
        this.externalId = externalId;
        this.personId = personId;
        this.linkedAt = linkedAt;
    }
}
