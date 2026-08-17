package org.courtside.dataexchange.internal;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.courtside.dataexchange.CanonicalField;

import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "import_source")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ImportSource {

    @Id
    private UUID id;

    @Column(name = "source_key", nullable = false)
    private String sourceKey;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column(name = "default_membership_type_id", nullable = false)
    private UUID defaultMembershipTypeId;

    @Column(name = "removal_warning_percent", nullable = false)
    private int removalWarningPercent;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "import_column_mapping", joinColumns = @JoinColumn(name = "source_id"))
    @MapKeyColumn(name = "column_header")
    @Enumerated(EnumType.STRING)
    @Column(name = "canonical_field", nullable = false)
    private Map<String, CanonicalField> columns = new HashMap<>();

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "import_type_mapping", joinColumns = @JoinColumn(name = "source_id"))
    @MapKeyColumn(name = "source_value")
    @Column(name = "membership_type_id", nullable = false)
    private Map<String, UUID> membershipTypes = new HashMap<>();

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "import_owned_field", joinColumns = @JoinColumn(name = "source_id"))
    @Enumerated(EnumType.STRING)
    @Column(name = "canonical_field", nullable = false)
    private Set<CanonicalField> ownedFields = new HashSet<>();

    public ImportSource(Instant createdAt) {
        this.id = UUID.randomUUID();
        this.createdAt = createdAt;
    }

    public void changeTo(String sourceKey, String displayName, Map<String, CanonicalField> columns,
                         Map<String, UUID> membershipTypes, UUID defaultMembershipTypeId,
                         Set<CanonicalField> ownedFields, int removalWarningPercent) {
        this.sourceKey = sourceKey;
        this.displayName = displayName;
        this.defaultMembershipTypeId = defaultMembershipTypeId;
        this.removalWarningPercent = removalWarningPercent;
        this.columns.clear();
        this.columns.putAll(columns);
        this.membershipTypes.clear();
        this.membershipTypes.putAll(membershipTypes);
        this.ownedFields.clear();
        this.ownedFields.addAll(ownedFields);
    }
}
