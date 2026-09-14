-- ============================================================
-- Adds an optional free-text description to a catalog module, shown in the
-- Adoption Template's Module Builder ("what this module covers, for other
-- CSMs reading the template"). Purely descriptive — nothing reads it to
-- drive scoring or scope.
-- ============================================================

alter table modules add column if not exists description text;
