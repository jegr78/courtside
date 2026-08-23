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

    // One grouped query for a whole page: a board about to send a credential should see whether the
    // address it goes to belongs to more than one person.
    @Query("""
            SELECT person.email, COUNT(person) FROM Person person
            WHERE person.email IN :addresses AND person.email <> ''
            GROUP BY person.email
            """)
    List<Object[]> countByAddressIn(@Param("addresses") Collection<String> addresses);

    @Query("""
            SELECT person FROM Person person
            WHERE lower(concat(person.firstName, ' ', person.lastName)) IN :nameKeys
            """)
    List<Person> findByNameKeyIn(@Param("nameKeys") Collection<String> nameKeys);

    @Query("""
            SELECT person.id FROM Person person
            WHERE lower(concat(person.firstName, ' ', person.lastName))
                  LIKE concat('%', :nameFragment, '%') ESCAPE '!'
              AND (:restricted = FALSE OR person.id IN :personIds)
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
                                          @Param("restricted") boolean restricted,
                                          @Param("personIds") Collection<UUID> personIds,
                                          @Param("after") UUID after, Pageable pageable);
}
