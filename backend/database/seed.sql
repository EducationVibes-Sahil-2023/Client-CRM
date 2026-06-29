-- =====================================================================
-- CRM Multi-Tenant — Seed data
-- Run AFTER schema.sql:
--   mysql -u root < database/seed.sql
-- =====================================================================

USE `crm_main`;

-- ---------------------------------------------------------------------
-- Default super admin
--   Email:    admin@example.com
--   Password: Password123!
-- (bcrypt hash below — change the password after first login)
-- ---------------------------------------------------------------------
INSERT INTO `users` (`email`, `password`, `role`, `client_id`, `created_at`, `updated_at`)
VALUES (
  'admin@example.com',
  '$2y$10$ABwydUsAwRU1LZ4591ylCO.pEvr4sJkQ9ht.mcJZb3hZcp4/gWx6K',
  'super_admin',
  NULL,
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE `password` = VALUES(`password`);

-- ---------------------------------------------------------------------
-- Default permission catalogue
-- ---------------------------------------------------------------------
INSERT INTO `permissions` (`role`, `permission_key`, `description`, `created_at`, `updated_at`) VALUES
  ('super_admin',  'clients.manage',   'Create and manage client tenants',        NOW(), NOW()),
  ('super_admin',  'features.manage',  'Toggle feature entitlements per client',  NOW(), NOW()),
  ('super_admin',  'admins.manage',    'Create client admin accounts',            NOW(), NOW()),
  ('client_admin', 'crm.view',         'View the client CRM dashboard',           NOW(), NOW()),
  ('client_admin', 'contacts.manage',  'Manage contacts',                         NOW(), NOW()),
  ('client_admin', 'settings.manage',  'Manage client CRM settings',              NOW(), NOW())
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

-- ---------------------------------------------------------------------
-- Default landing-page content (editable by the super admin in the
-- "Landing page" tab of the admin dashboard). `logo_url` is empty so the
-- site falls back to the lettermark until a logo is uploaded.
-- ---------------------------------------------------------------------
INSERT INTO `landing_settings` (`setting_key`, `setting_value`, `created_at`, `updated_at`) VALUES
  ('logo_url',     '', NOW(), NOW()),
  ('company_name', 'Nexus CRM', NOW(), NOW()),
  ('pricing_plans',
   '[{"tier":"GROWTH","price":"$49","period":"/per month","features":["Up to 5,000 leads","Call tracking","Email integration","Basic dashboard"],"cta":"Request a Demo","highlighted":false},{"tier":"PROFESSIONAL","price":"$99","period":"/per month","features":["Unlimited leads","Advanced lead routing","Task management","Real-time notifications","24/7 priority support"],"cta":"Request a Demo","highlighted":true},{"tier":"ENTERPRISE","price":"Custom","period":"","features":["Dedicated instance","Custom roles & permissions","SSO & SAML","Announcements & broadcasts"],"cta":"Contact Sales","highlighted":false}]',
   NOW(), NOW()),
  ('testimonials',
   '[{"initials":"SR","name":"Sara Reyes","role":"VP of Revenue, Northwind","text":"Nexus cut our lead response time from hours to minutes. The notifications and call tracker alone paid for the platform."},{"initials":"DK","name":"Daniel Kim","role":"Sales Director, Vertex","text":"We finally have one source of truth for every lead. Reporting that used to take a day now takes a click."},{"initials":"AO","name":"Amara Okafor","role":"Founder, Lumen Studio","text":"Setup took an afternoon. The pipeline view and auto-routing transformed how my small team sells."},{"initials":"MP","name":"Marco Pereira","role":"Head of Growth, Quanta","text":"Lead transfer and staff management make it effortless to scale the team without losing accountability."},{"initials":"JT","name":"Julia Tan","role":"Ops Manager, Arcadia","text":"The live dashboard is the first thing our team opens every morning. Total visibility into the pipeline."},{"initials":"RH","name":"Ravi Hegde","role":"CEO, Helix Labs","text":"Real-time chat plus the call tracker means context never gets lost between reps. Conversions are up 40%."}]',
   NOW(), NOW())
ON DUPLICATE KEY UPDATE `setting_value` = `landing_settings`.`setting_value`;
