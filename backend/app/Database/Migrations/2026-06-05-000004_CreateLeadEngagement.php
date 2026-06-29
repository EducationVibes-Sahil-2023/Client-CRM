<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-lead engagement: timed reminders and free-text notes. Both live in each
 * client's own database (mirrored via TenantSchema / `php spark tenants:sync`)
 * and are soft-deletable. A reminder fires a notification once its `remind_at`
 * passes (materialised lazily on the client's notification poll).
 */
class CreateLeadEngagement extends Migration
{
    public function up()
    {
        if (! $this->db->tableExists('lead_reminders')) {
            $this->forge->addField([
                'id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'lead_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'user_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true], // recipient (client admin)
                'remind_at'   => ['type' => 'DATETIME'],
                'note'        => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
                'notified_at' => ['type' => 'DATETIME', 'null' => true],
                'done'        => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
                'created_at'  => ['type' => 'DATETIME', 'null' => true],
                'updated_at'  => ['type' => 'DATETIME', 'null' => true],
                'deleted_at'  => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->addKey('lead_id');
            $this->forge->addKey(['user_id', 'notified_at']);
            $this->forge->createTable('lead_reminders');
        }

        if (! $this->db->tableExists('lead_notes')) {
            $this->forge->addField([
                'id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'lead_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'author_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
                'author_name' => ['type' => 'VARCHAR', 'constraint' => 150, 'null' => true],
                'body'        => ['type' => 'TEXT'],
                'created_at'  => ['type' => 'DATETIME', 'null' => true],
                'updated_at'  => ['type' => 'DATETIME', 'null' => true],
                'deleted_at'  => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->addKey('lead_id');
            $this->forge->createTable('lead_notes');
        }
    }

    public function down()
    {
        $this->forge->dropTable('lead_notes', true);
        $this->forge->dropTable('lead_reminders', true);
    }
}
