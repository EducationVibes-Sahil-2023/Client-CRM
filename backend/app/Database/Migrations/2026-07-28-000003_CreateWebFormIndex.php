<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * MAIN-DB-ONLY registry mapping a public form token → its owning client + form.
 *
 * A public form request (`/public/forms/{token}`) has NO session, so the token
 * alone must resolve which tenant database holds the form. This tiny index in
 * crm_main gives that O(1) lookup with opaque tokens. It is deliberately NOT in
 * TenantSchema::TABLES — it never lives in a tenant DB. Kept in sync by the admin
 * create/update/delete handlers (the form's config itself stays in the tenant DB).
 */
class CreateWebFormIndex extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('web_form_index')) {
            return;
        }

        $this->forge->addField([
            'token'      => ['type' => 'VARCHAR', 'constraint' => 64],
            'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'form_id'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('token', true); // token is the primary key
        $this->forge->addKey('client_id');
        $this->forge->createTable('web_form_index', true);
    }

    public function down()
    {
        $this->forge->dropTable('web_form_index', true);
    }
}
