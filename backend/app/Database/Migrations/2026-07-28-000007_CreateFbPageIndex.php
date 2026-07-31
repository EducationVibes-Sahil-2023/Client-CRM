<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * MAIN-DB-ONLY registry mapping a Facebook Page id → its owning client, so the
 * sessionless leadgen webhook can resolve which tenant DB a lead belongs to
 * (the webhook payload only carries the page id). Same pattern as web_form_index;
 * NOT in TenantSchema::TABLES. Kept in sync when a client connects/disconnects a page.
 */
class CreateFbPageIndex extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('fb_page_index')) {
            return;
        }
        $this->forge->addField([
            'page_id'     => ['type' => 'VARCHAR', 'constraint' => 64],
            'client_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'page_row_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'enabled'     => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at'  => ['type' => 'DATETIME', 'null' => true],
            'updated_at'  => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('page_id', true); // page id is the primary key
        $this->forge->addKey('client_id');
        $this->forge->createTable('fb_page_index', true);
    }

    public function down()
    {
        $this->forge->dropTable('fb_page_index', true);
    }
}
