<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Real-time (polled) chat + in-app notifications.
 *
 * Participants are addressed by (party_type, party_id) so the same tables serve
 * super-admin ↔ client-admin "support" chat today and client-admin ↔ staff
 * "team" chat later, without a schema change:
 *   - party_type 'user'  → users.id        (super_admin / client_admin)
 *   - party_type 'staff' → client_staff.id (added in a later phase)
 */
class CreateChatAndNotifications extends Migration
{
    public function up()
    {
        // conversations -----------------------------------------------------
        $this->forge->addField([
            'id'              => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'type'            => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'support'],
            'title'           => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'last_message_at' => ['type' => 'DATETIME', 'null' => true],
            'created_at'      => ['type' => 'DATETIME', 'null' => true],
            'updated_at'      => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['type', 'client_id']);
        $this->forge->createTable('conversations');

        // conversation_participants (also holds each member's read marker) ---
        $this->forge->addField([
            'id'              => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'conversation_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'party_type'      => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'user'],
            'party_id'        => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'last_read_at'    => ['type' => 'DATETIME', 'null' => true],
            'created_at'      => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('conversation_id');
        $this->forge->addUniqueKey(['conversation_id', 'party_type', 'party_id']);
        $this->forge->createTable('conversation_participants');

        // chat_messages -----------------------------------------------------
        $this->forge->addField([
            'id'              => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'conversation_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'sender_type'     => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'user'],
            'sender_id'       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'body'            => ['type' => 'TEXT'],
            'created_at'      => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['conversation_id', 'id']);
        $this->forge->createTable('chat_messages');

        // app_notifications -------------------------------------------------
        $this->forge->addField([
            'id'             => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'recipient_type' => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'user'],
            'recipient_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'type'           => ['type' => 'VARCHAR', 'constraint' => 50, 'default' => 'chat_message'],
            'title'          => ['type' => 'VARCHAR', 'constraint' => 255],
            'body'           => ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true],
            'link'           => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'read_at'        => ['type' => 'DATETIME', 'null' => true],
            'created_at'     => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['recipient_type', 'recipient_id', 'read_at']);
        $this->forge->createTable('app_notifications');
    }

    public function down()
    {
        $this->forge->dropTable('app_notifications');
        $this->forge->dropTable('chat_messages');
        $this->forge->dropTable('conversation_participants');
        $this->forge->dropTable('conversations');
    }
}
