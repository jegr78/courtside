ALTER TABLE retention_policy DROP CONSTRAINT retention_policy_category_known;
ALTER TABLE retention_policy ADD CONSTRAINT retention_policy_category_known
    CHECK (category IN ('BOOKINGS', 'FORMER_MEMBERS', 'EXTERNAL_ACCOUNTS'));

ALTER TABLE retention_preview ADD COLUMN externals_inactive_before timestamptz;
ALTER TABLE retention_preview ADD COLUMN external_account_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE retention_preview DROP CONSTRAINT retention_preview_covers_a_category;
ALTER TABLE retention_preview ADD CONSTRAINT retention_preview_covers_a_category
    CHECK (bookings_ended_before IS NOT NULL OR memberships_ended_before IS NOT NULL
           OR externals_inactive_before IS NOT NULL);
ALTER TABLE retention_preview ADD CONSTRAINT retention_preview_externals_need_a_cutoff
    CHECK (externals_inactive_before IS NOT NULL OR cardinality(external_account_ids) = 0);
