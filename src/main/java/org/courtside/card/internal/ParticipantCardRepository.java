package org.courtside.card.internal;

import org.courtside.card.ParticipantCard;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface ParticipantCardRepository extends JpaRepository<ParticipantCard, UUID> {

    List<ParticipantCard> findByActiveTrueOrderByLabelAsc();

    List<ParticipantCard> findAllByOrderByLabelAsc();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT card FROM ParticipantCard card WHERE card.id IN :ids ORDER BY card.id")
    List<ParticipantCard> lockAllById(@Param("ids") Collection<UUID> ids);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE ParticipantCard card
            SET card.label = :label
            WHERE card.id = :id AND card.label <> :label AND card.label IN :shipped
            """)
    void nameShippedCard(@Param("id") UUID id, @Param("label") String label,
                         @Param("shipped") Collection<String> shipped);
}
