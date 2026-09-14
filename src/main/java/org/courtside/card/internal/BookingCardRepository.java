package org.courtside.card.internal;

import org.courtside.card.BookingCard;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface BookingCardRepository extends JpaRepository<BookingCard, UUID> {

    List<BookingCard> findByActiveTrueOrderByLabelAsc();

    List<BookingCard> findAllByOrderByLabelAsc();

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE BookingCard card
            SET card.label = :label
            WHERE card.id = :id AND card.label <> :label AND card.label IN :shipped
            """)
    void nameShippedCard(@Param("id") UUID id, @Param("label") String label,
                         @Param("shipped") Collection<String> shipped);
}
