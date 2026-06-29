<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Adds file-attachment support to chat messages. A message may now carry an
 * uploaded file (image or document) in addition to — or instead of — text, so
 * `body` becomes effectively optional at the app layer when an attachment is
 * present. Files are stored under public/uploads/chat and referenced by URL.
 */
class AddChatAttachments extends Migration
{
    public function up()
    {
        $this->forge->addColumn('chat_messages', [
            'attachment_url'  => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true, 'after' => 'body'],
            'attachment_name' => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true, 'after' => 'attachment_url'],
            'attachment_type' => ['type' => 'VARCHAR', 'constraint' => 100, 'null' => true, 'after' => 'attachment_name'],
            'attachment_size' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'attachment_type'],
        ]);
    }

    public function down()
    {
        $this->forge->dropColumn('chat_messages', [
            'attachment_url',
            'attachment_name',
            'attachment_type',
            'attachment_size',
        ]);
    }
}
