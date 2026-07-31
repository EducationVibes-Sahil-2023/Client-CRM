<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * A subscribed Facebook lead form + how its submissions map onto a CRM lead.
 * Deliberately mirrors `web_forms`' assignment/dedupe/notify columns so the
 * shared WebLeadIngest engine (state map + round-robin, dedupe, notify) works
 * verbatim. Tenant table (in TenantSchema::TABLES). `field_map` maps each FB form
 * field name → a lead key (built-in) or `custom_<key>`.
 */
class CreateFbForms extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('fb_forms')) {
            return;
        }
        $this->forge->addField([
            'id'                       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'                => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'page_id'                  => ['type' => 'VARCHAR', 'constraint' => 64],
            'form_id'                  => ['type' => 'VARCHAR', 'constraint' => 64],
            'form_name'                => ['type' => 'VARCHAR', 'constraint' => 191, 'default' => ''],
            'field_map'                => ['type' => 'MEDIUMTEXT', 'null' => true], // JSON: fbFieldName → leadKey|custom_<key>
            // Lead mapping (same names WebLeadIngest reads).
            'source_id'                => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'status_id'                => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'lead_type_id'             => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'assigned_to'              => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'auto_assignee'            => ['type' => 'TEXT', 'null' => true],
            'auto_assign_state_wise'   => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'state_assignee_map'       => ['type' => 'TEXT', 'null' => true],
            'state_cursors'            => ['type' => 'TEXT', 'null' => true],
            'assign_cursor'            => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'allow_duplicate'          => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'prevent_duplicate_field'  => ['type' => 'VARCHAR', 'constraint' => 40, 'null' => true],
            'prevent_duplicate_field2' => ['type' => 'VARCHAR', 'constraint' => 40, 'null' => true],
            'create_duplicate_as_task' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'notify_on_import'         => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'notify_type'              => ['type' => 'VARCHAR', 'constraint' => 20, 'null' => true],
            'notify_staff'             => ['type' => 'TEXT', 'null' => true],
            'submission_count'         => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'last_lead_time'           => ['type' => 'DATETIME', 'null' => true], // high-water mark for polling
            'enabled'                  => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at'               => ['type' => 'DATETIME', 'null' => true],
            'updated_at'               => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'               => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->addKey('form_id');
        $this->forge->createTable('fb_forms', true);
    }

    public function down()
    {
        $this->forge->dropTable('fb_forms', true);
    }
}
