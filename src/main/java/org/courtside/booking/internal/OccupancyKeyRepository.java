package org.courtside.booking.internal;

import org.springframework.data.jpa.repository.JpaRepository;

interface OccupancyKeyRepository extends JpaRepository<OccupancyKey, Short> {
}
