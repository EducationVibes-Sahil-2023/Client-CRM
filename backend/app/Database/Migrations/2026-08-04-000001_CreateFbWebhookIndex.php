<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * MAIN-DB-ONLY registry mapping a per-client Facebook webhook URL token → its
 * owning client, so the sessionless leadgen webhook can resolve the tenant from
 * the token in the URL path (/public/fb/webhook/{token}) BEFORE any page id is
 * known (needed for the GET verify handshake, which carries no page/client id).
 * Same pattern as fb_page_index / web_form_index; NOT in TenantSchema::TABLES.
 */
class CreateFbWebhookIndex extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('fb_webhook_index')) {
            return;
        }
        $this->forge->addField([
            'token'      => ['type' => 'VARCHAR', 'constraint' => 64],
            'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('token', true); // the URL token is the primary key
        $this->forge->addKey('client_id');
        $this->forge->createTable('fb_webhook_index', true);
    }

    public function down()
    {
        $this->forge->dropTable('fb_webhook_index', true);
    }
}
