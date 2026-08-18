CREATE INDEX booking_participant_person
    ON booking_participant (person_id)
    WHERE person_id IS NOT NULL;
