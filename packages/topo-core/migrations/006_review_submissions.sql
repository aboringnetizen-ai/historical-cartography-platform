CREATE TABLE cartography.map_review_submissions (
  review_id uuid PRIMARY KEY,
  changeset_id uuid NOT NULL REFERENCES cartography.spatial_changesets,
  revision_id uuid NOT NULL REFERENCES cartography.topology_revisions,
  bound_events jsonb NOT NULL
    CHECK (jsonb_typeof(bound_events) = 'array' AND jsonb_array_length(bound_events) > 0),
  submitted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  invalidated_at timestamptz
);

CREATE UNIQUE INDEX one_active_review_per_revision ON cartography.map_review_submissions (changeset_id, revision_id)
WHERE invalidated_at IS NULL;

CREATE FUNCTION cartography.invalidate_previous_draft_reviews()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE cartography.map_review_submissions
  SET invalidated_at = transaction_timestamp()
  WHERE changeset_id = NEW.changeset_id AND revision_id <> NEW.revision_id AND invalidated_at IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invalidate_reviews_on_draft_change
AFTER INSERT OR UPDATE OF revision_id ON cartography.draft_heads
FOR EACH ROW EXECUTE FUNCTION cartography.invalidate_previous_draft_reviews();
