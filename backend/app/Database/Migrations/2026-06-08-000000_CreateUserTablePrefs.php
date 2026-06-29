<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-user table layout preferences (which columns are shown, their order,
 * widths and alignment) for any data table in the client dashboard — keyed by
 * a logical `table_key` such as "leads".
 *
 * Lives in each client's own database (mirrored from the main DB via
 * TenantSchema / `php spark tenants:sync`). One row per (user, table); the
 * whole layout is stored as JSON in `config`. A unique key keeps a single row
 * per user/table so saves are a clean upsert and one user's layout never
 * affects another's.
 */
class CreateUserTablePrefs extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('user_table_prefs')) {
            return;
        }

        $this->forge->addField([
            'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'user_id'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'table_key'  => ['type' => 'VARCHAR', 'constraint' => 64],
            'config'     => ['type' => 'TEXT', 'null' => true],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey(['client_id', 'user_id', 'table_key']);
        $this->forge->createTable('user_table_prefs');
    }

    public function down()
    {
        $this->forge->dropTable('user_table_prefs', true);
    }
}
