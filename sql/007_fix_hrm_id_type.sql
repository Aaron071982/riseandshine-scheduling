-- Fix hrm_id column type to support CUIDs (strings) from HRM
-- HRM uses CUID format (e.g., "cmiwspukr0004w45oldvf4b13") not UUIDs

ALTER TABLE rbt_profiles ALTER COLUMN hrm_id TYPE TEXT;
