ALTER TABLE domain_event
    DROP CONSTRAINT domain_event_subject_required,
    ADD CONSTRAINT domain_event_subject_required CHECK (
        subject_id IS NOT NULL
            OR event_type IN ('dataexchange.log.exported', 'booking.occupancyKey.created', 'booking.occupancyKey.revoked',
                              'access.control.checkRequested'));
