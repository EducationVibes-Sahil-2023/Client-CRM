# Architecture Overview

## Frontend

- Built with Next.js and React
- Pages for landing, login, dashboard, and plan selection
- Uses API layer to connect with PHP backend
- Permission-aware UI components

## Backend

- Built with CodeIgniter 4
- Super admin, client admin, auth, and settings controllers
- Models for users, clients, features, permissions, and DB connections
- Multi-tenant support through dynamic database routing

## Data model

- `users` — super admin, client admin, and system users
- `clients` — stores client metadata and plan details
- `client_databases` — per-client DB connection info
- `features` — list of CRM features and flags
- `permissions` — role-based access controls

## Multi-db design

- The CRM product is a single shared application codebase.
- One central `crm_main` database stores tenant metadata, users, permissions, and feature entitlement.
- Each client gets a dedicated tenant database for their CRM data, while the product remains the same.
- Backend resolves the correct client database by client identifier and routes tenant data accordingly.

## Documentation

- `docs/setup.md` covers installation and environment configuration
- `scripts/generate-docs.js` can produce documentation snippets from code metadata
- Keep docs updated when feature implementation changes
