package org.courtside.access.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface AccessGrantRepository extends JpaRepository<AccessGrant, UUID> {
}
