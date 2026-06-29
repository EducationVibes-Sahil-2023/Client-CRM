<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateCalendarEvents extends Migration
{
    public function up()
    {
        $this->forge->addField([
            'id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'title'       => ['type' => 'VARCHAR', 'constraint' => 255],
            'description' => ['type' => 'TEXT', 'null' => true],
            'event_date'  => ['type' => 'DATE'],
            'start_time'  => ['type' => 'TIME', 'null' => true],
            'end_time'    => ['type' => 'TIME', 'null' => true],
            'color'       => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
            'created_by'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'created_at'  => ['type' => 'DATETIME', 'null' => true],
            'updated_at'  => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('event_date');
        $this->forge->createTable('calendar_events');
    }

    public function down()
    {
        $this->forge->dropTable('calendar_events');
    }
}
