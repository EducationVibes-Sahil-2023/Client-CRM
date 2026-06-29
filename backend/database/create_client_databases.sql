-- =====================================================================
-- Helper: create per-client (tenant) databases.
-- Each client gets an isolated database; register its name on the client
-- record via the super-admin "create client" endpoint.
--
-- Replace the example names below with your real client database names.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `client_acme`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE DATABASE IF NOT EXISTS `client_beta`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
