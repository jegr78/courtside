package org.courtside.config.internal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.Immutable;

import java.util.UUID;

@Entity
@Table(name = "club_config")
@Immutable
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class ClubTimeZoneConfiguration {

    @Id
    private UUID id;

    @Column(name = "time_zone", nullable = false)
    private String timeZone;
}
