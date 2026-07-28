-- sender_profiles.language was `text NOT NULL DEFAULT 'en'`, which made "the
-- SDR explicitly chose English" indistinguishable from "never touched the
-- language selector" — every profile started life as 'en' whether or not an
-- admin ever picked a language. The scraper backend's message_generator now
-- treats NULL as "unset, defer to the market's own language" and any
-- non-NULL value (including 'en') as an explicit SDR choice that must win
-- over the market (see linkedin-scraper's api/message_generator.py,
-- _resolve_language). This was the root cause of QA-P1: messages coming back
-- in the wrong language across Canada/US, Taiwan/Hong Kong and other runs.
ALTER TABLE sender_profiles ALTER COLUMN language DROP NOT NULL;
ALTER TABLE sender_profiles ALTER COLUMN language DROP DEFAULT;
