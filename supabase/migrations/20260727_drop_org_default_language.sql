-- organizations.default_language was dead code — read and written
-- everywhere it appeared in Settings and Global Admin's org forms, but
-- never consumed anywhere to actually change UI locale or message
-- generation language. Confirmed via full-codebase search before removal.
-- If a per-org default UI locale is ever needed, it should be built as a
-- new, clearly-named feature rather than reusing this column.

ALTER TABLE public.organizations DROP COLUMN IF EXISTS default_language;
