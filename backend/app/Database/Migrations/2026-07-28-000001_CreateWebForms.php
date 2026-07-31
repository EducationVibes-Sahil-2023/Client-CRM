<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Web-to-Lead form definitions. One row = one embeddable public form that
 * captures leads into this client's own `leads` table.
 *
 * Created in crm_main so TenantSchema can `CREATE TABLE … LIKE crm_main.web_forms`
 * into every tenant DB; `web_forms` is in TenantSchema::TABLES, so the data itself
 * lives only in each client's isolated database (never crm_main).
 *
 * The public token → client mapping is NOT here — it lives in the main-only
 * `web_form_index` table so a sessionless public request can resolve the tenant.
 */
class CreateWebForms extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('web_forms')) {
            return;
        }

        $this->forge->addField([
            'id'                       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'                => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'                     => ['type' => 'VARCHAR', 'constraint' => 150, 'default' => ''],
            'token'                    => ['type' => 'VARCHAR', 'constraint' => 64],
            'language'                 => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'en'],
            'submit_text'              => ['type' => 'VARCHAR', 'constraint' => 100, 'default' => 'Submit'],
            'success_message'          => ['type' => 'TEXT', 'null' => true],
            // Ordered field definitions (JSON): built-in lead keys + custom fields.
            'fields'                   => ['type' => 'MEDIUMTEXT', 'null' => true],
            // How a submission maps onto the lead.
            'source_id'                => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'status_id'                => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'assigned_to'              => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'lead_type_id'             => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            // Auto-assignment engine.
            'auto_assignee'            => ['type' => 'TEXT', 'null' => true],           // JSON array of staff ids (round-robin pool)
            'auto_assign_state_wise'   => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'state_assignee_map'       => ['type' => 'TEXT', 'null' => true],           // JSON { stateName: staffId }
            'assign_cursor'            => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            // Behaviour flags.
            'auto_mark_public'         => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'allow_location_fields'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'notify_on_transfer'       => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'allow_duplicate'          => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'prevent_duplicate_field'  => ['type' => 'VARCHAR', 'constraint' => 40, 'null' => true],
            'prevent_duplicate_field2' => ['type' => 'VARCHAR', 'constraint' => 40, 'null' => true],
            'create_duplicate_as_task' => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            // Notifications.
            'notify_on_import'         => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 0],
            'notify_type'              => ['type' => 'VARCHAR', 'constraint' => 20, 'null' => true], // specific|roles|responsible
            'notify_staff'             => ['type' => 'TEXT', 'null' => true],           // JSON array of staff ids
            'submission_count'         => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'enabled'                  => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at'               => ['type' => 'DATETIME', 'null' => true],
            'updated_at'               => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'               => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('token');
        $this->forge->addKey('client_id');
        $this->forge->createTable('web_forms', true);
    }

    public function down()
    {
        $this->forge->dropTable('web_forms', true);
    }
}
