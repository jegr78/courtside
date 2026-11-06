package org.courtside.dataexchange.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Embeddable
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AgeBandEntry {

    @Column(name = "source_value", nullable = false)
    private String sourceValue;

    @Column(name = "lower_bound", nullable = false)
    private int lowerBound;

    @Column(name = "membership_type_id", nullable = false)
    private UUID membershipTypeId;

    public AgeBandEntry(String sourceValue, int lowerBound, UUID membershipTypeId) {
        this.sourceValue = sourceValue;
        this.lowerBound = lowerBound;
        this.membershipTypeId = membershipTypeId;
    }
}
