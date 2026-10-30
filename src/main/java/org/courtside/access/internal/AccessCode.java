package org.courtside.access.internal;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "access_code")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AccessCode {

    @Id
    private String code;

    private UUID grantId;

    private Instant until;
}
