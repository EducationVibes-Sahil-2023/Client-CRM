# Setup Instructions

## Prerequisites

- Node.js 18+ and npm
- PHP 8.1+ with CLI and PDO extensions
- Composer
- MySQL or MariaDB

## Frontend setup

1. Change into the frontend folder:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment example:
   ```bash
   cp .env.local.example .env.local
   ```
4. Run development server:
   ```bash
   npm run dev
   ```

## Backend setup

1. Change into the backend folder:
   ```bash
   cd backend
   ```
2. Install Composer dependencies:
   ```bash
   composer install
   ```
3. Copy environment file:
   ```bash
   cp .env.example .env
   ```
4. Use phpMyAdmin to create the main CRM database and any client databases:
   - Open `http://localhost/phpmyadmin/index.php`
   - Create database `crm_main`
   - Create client database names like `client_abc`, `client_xyz`, etc.
   - Run the SQL schema in `backend/database/schema.sql` to create tables.
   - Optionally import `backend/database/seed.sql` to add a default super admin user.
   - `crm_main` stores shared product metadata and user access control.
   - Each `client_*` database stores that clients tenant CRM data.
5. Configure each client database in `app/Config/Database.php`
6. Run the backend dev server:
   ```bash
   php -S localhost:8080 -t public
   ```

## Documentation refresh

After making changes to controllers, models, or pages, run:

```bash
node scripts/generate-docs.js
```

This updates the generated documentation artifacts.
