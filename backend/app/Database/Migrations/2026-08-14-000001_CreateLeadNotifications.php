<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Lead notification RULES + a per-lead send LOG.
 *
 * A rule = a timed reminder the admin builds (e.g. "Fresh lead not called in 2h"):
 * criteria + an hour/day threshold since assignment + a templated message +
 * recipients (assigned rep and/or their team leader) + web-push toggle.
 *
 * The log records each (rule, lead) send so a reminder fires once per assignment
 * cycle (a reassignment re-stamps assigned_date, which reopens the cycle).
 *
 * Both created in crm_main so TenantSchema mirrors them into every tenant DB; the
 * data lives only in each client's isolated database.
 */
class CreateLeadNotifications extends Migration
{
    public function up()
    {
        if (! $this->db->tableExists('lead_notification_rules')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'name'       => ['type' => 'VARCHAR', 'constraint' => 150, 'default' => ''],
                'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
                'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
                'config'     => ['type' => 'MEDIUMTEXT', 'null' => true], // criteria + timing + message + recipients (JSON)
                'created_at' => ['type' => 'DATETIME', 'null' => true],
                'updated_at' => ['type' => 'DATETIME', 'null' => true],
                'deleted_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->createTable('lead_notification_rules', true);
        }

        if (! $this->db->tableExists('lead_notification_log')) {
            $this->forge->addField([
                'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
                'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'rule_id'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'lead_id'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
                'sent_at'    => ['type' => 'DATETIME', 'null' => true],
                'created_at' => ['type' => 'DATETIME', 'null' => true],
            ]);
            $this->forge->addKey('id', true);
            $this->forge->addKey('client_id');
            $this->forge->addKey(['rule_id', 'lead_id']);
            $this->forge->createTable('lead_notification_log', true);
        }
    }

    public function down()
    {
        $this->forge->dropTable('lead_notification_log', true);
        $this->forge->dropTable('lead_notification_rules', true);
    }
}
