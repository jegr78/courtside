package org.courtside.identity;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PersonRepository extends JpaRepository<Person, UUID> {

    // user_account carries no unique person, so the person row is the one to lock.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Person> findWithLockById(UUID id);

    @Query("""
            SELECT person FROM Person person
            WHERE lower(concat(person.firstName, ' ', person.lastName)) IN :nameKeys
            """)
    List<Person> findByNameKeyIn(@Param("nameKeys") Collection<String> nameKeys);

    @Query("""
            SELECT person.id FROM Person person
            WHERE lower(concat(person.firstName, ' ', person.lastName))
                  LIKE concat('%', :nameFragment, '%') ESCAPE '!'
              AND (:after IS NULL
                OR lower(person.lastName) > (SELECT lower(c.lastName) FROM Person c WHERE c.id = :after)
                OR (lower(person.lastName) = (SELECT lower(c.lastName) FROM Person c WHERE c.id = :after)
                    AND (lower(person.firstName)
                             > (SELECT lower(c.firstName) FROM Person c WHERE c.id = :after)
                         OR (lower(person.firstName)
                                 = (SELECT lower(c.firstName) FROM Person c WHERE c.id = :after)
                             AND person.id > :after))))
            ORDER BY lower(person.lastName), lower(person.firstName), person.id
            """)
    List<UUID> findIdsByNameFragmentAfter(@Param("nameFragment") String nameFragment,
                                          @Param("after") UUID after, Pageable pageable);
}
