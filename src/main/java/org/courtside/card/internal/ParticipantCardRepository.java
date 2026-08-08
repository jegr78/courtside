package org.courtside.card.internal;

import org.courtside.card.ParticipantCard;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ParticipantCardRepository extends JpaRepository<ParticipantCard, UUID> {

    List<ParticipantCard> findByActiveTrueOrderByLabelAsc();

    List<ParticipantCard> findAllByOrderByLabelAsc();
}
