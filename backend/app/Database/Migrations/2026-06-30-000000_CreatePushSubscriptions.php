<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Browser Web Push subscriptions (one row per device/browser).
 *
 * Lives in the MAIN database alongside `app_notifications` (notifications are
 * not tenant-scoped). Each row pins a push endpoint to a recipient — the same
 * (recipient_type, recipient_id) pair the in-app notifications use — plus the
 * client_id so sends can be scoped/gated per client. `endpoint_hash`
 * (sha256 of the endpoint) carries the UNIQUE key, since push endpoints are too
 * long for a utf8mb4 unique index on the raw value; it makes re-subscribing a
 * clean upsert.
 */
class CreatePushSubscriptions extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('push_subscriptions')) {
            return;
        }

        $this->forge->addField([
            'id'             => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'      => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'recipient_type' => ['type' => 'VARCHAR', 'constraint' => 20],   // 'user' | 'staff'
            'recipient_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'endpoint'       => ['type' => 'TEXT'],
            'endpoint_hash'  => ['type' => 'CHAR', 'constraint' => 64],      // sha256(endpoint)
            'p256dh'         => ['type' => 'VARCHAR', 'constraint' => 255],
            'auth'           => ['type' => 'VARCHAR', 'constraint' => 255],
            'user_agent'     => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'created_at'     => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addUniqueKey('endpoint_hash');
        $this->forge->addKey(['client_id', 'recipient_type', 'recipient_id']);
        $this->forge->createTable('push_subscriptions');
    }

    public function down()
    {
        $this->forge->dropTable('push_subscriptions', true);
    }
}
