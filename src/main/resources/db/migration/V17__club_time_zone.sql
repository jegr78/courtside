ALTER TABLE club_config
    ADD COLUMN time_zone text NOT NULL DEFAULT 'Europe/Berlin',
    ADD CONSTRAINT club_config_time_zone_not_blank
        CHECK (length(btrim(time_zone)) > 0);

ALTER TABLE club_config ALTER COLUMN time_zone DROP DEFAULT;

CREATE FUNCTION reject_unknown_club_time_zone() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF length(btrim(NEW.time_zone)) > 0
       AND NOT EXISTS (SELECT FROM pg_timezone_names WHERE name = NEW.time_zone) THEN
        RAISE EXCEPTION 'club_config_time_zone_known'
            USING ERRCODE = '23514', CONSTRAINT = 'club_config_time_zone_known';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER club_config_time_zone_known
    BEFORE INSERT OR UPDATE OF time_zone ON club_config
    FOR EACH ROW EXECUTE FUNCTION reject_unknown_club_time_zone();
