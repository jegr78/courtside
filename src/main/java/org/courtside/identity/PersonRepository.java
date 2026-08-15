package org.courtside.identity;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface PersonRepository extends JpaRepository<Person, UUID> {

    List<Person> findByEmailIgnoreCase(String email);

    @Query("""
            SELECT person.id FROM Person person
            WHERE lower(concat(person.firstName, ' ', person.lastName))
                  LIKE concat('%', :query, '%') ESCAPE '!'
              AND (:cursor IS NULL
                OR lower(person.lastName) > (SELECT lower(c.lastName) FROM Person c WHERE c.id = :cursor)
                OR (lower(person.lastName) = (SELECT lower(c.lastName) FROM Person c WHERE c.id = :cursor)
                    AND (lower(person.firstName)
                             > (SELECT lower(c.firstName) FROM Person c WHERE c.id = :cursor)
                         OR (lower(person.firstName)
                                 = (SELECT lower(c.firstName) FROM Person c WHERE c.id = :cursor)
                             AND person.id > :cursor))))
            ORDER BY lower(person.lastName), lower(person.firstName), person.id
            """)
    List<UUID> findRosterIds(@Param("query") String query, @Param("cursor") UUID cursor, Pageable pageable);
}
