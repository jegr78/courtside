package org.courtside.rules.internal;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface RuleSetRepository extends JpaRepository<RuleSet, UUID> {

    List<RuleSet> findAllByOrderByNameAsc();
}
