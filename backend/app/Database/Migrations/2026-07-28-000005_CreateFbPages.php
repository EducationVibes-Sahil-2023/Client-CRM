<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Facebook Pages a client has connected (via OAuth). One row per Page; holds the
 * long-lived Page access token used to fetch lead forms + lead data from the Graph
 * API. Tenant table (added to TenantSchema::TABLES) — created in crm_main so the
 * per-tenant `CREATE TABLE … LIKE` sync works; data lives only in each client DB.
 */
class CreateFbPages extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('fb_pages')) {
            return;
        }
        $this->forge->addField([
            'id'           => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'    => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'page_id'      => ['type' => 'VARCHAR', 'constraint' => 64],
            'page_name'    => ['type' => 'VARCHAR', 'constraint' => 191, 'default' => ''],
            'access_token' => ['type' => 'TEXT', 'null' => true], // long-lived Page token
            'user_token'   => ['type' => 'TEXT', 'null' => true], // long-lived User token (for re-listing pages)
            'enabled'      => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at'   => ['type' => 'DATETIME', 'null' => true],
            'updated_at'   => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'   => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->addKey('page_id');
        $this->forge->createTable('fb_pages', true);
    }

    public function down()
    {
        $this->forge->dropTable('fb_pages', true);
    }
}
