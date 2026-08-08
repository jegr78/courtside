package org.courtside.card.internal;

import org.courtside.card.BookingCard;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface BookingCardRepository extends JpaRepository<BookingCard, UUID> {

    List<BookingCard> findByActiveTrueOrderByLabelAsc();

    List<BookingCard> findAllByOrderByLabelAsc();
}
