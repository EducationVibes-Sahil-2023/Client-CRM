<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Global platform settings (key/value), managed by the super admin from the
 * admin panel. Used for integration credentials such as the Gmail inbox, so
 * they live in the database instead of the .env file.
 */
class CreateAppSettings extends Migration
{
    public function up()
    {
        $this->forge->addField([
            'id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'setting_key'   => ['type' => 'VARCHAR', 'constraint' => 100],
            'setting_value' => ['type' => 'TEXT', 'null' => true],
            'created_at'    => ['type' => 'DATETIME', 'null' => true],
            'updated_at'    => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('setting_key');
        $this->forge->createTable('app_settings');
    }

    public function down()
    {
        $this->forge->dropTable('app_settings');
    }
}
