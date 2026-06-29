<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Lead types (Fresh, Hot, Cold…) and conversion types (e.g. "Prospect") which
 * each group MULTIPLE lead types. Both have colour, sequence and status.
 */
class CreateConversionTypes extends Migration
{
    public function up()
    {
        // Lead types.
        $this->forge->addField([
            'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'       => ['type' => 'VARCHAR', 'constraint' => 100],
            'color'      => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
            'sequence'   => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'enabled'    => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('lead_types');

        // Conversion types — group multiple lead types (stored as JSON ids).
        $this->forge->addField([
            'id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'          => ['type' => 'VARCHAR', 'constraint' => 100],
            'color'         => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
            'sequence'      => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'enabled'       => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'lead_type_ids' => ['type' => 'TEXT', 'null' => true],
            'created_at'    => ['type' => 'DATETIME', 'null' => true],
            'updated_at'    => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('conversion_types');
    }

    public function down()
    {
        $this->forge->dropTable('conversion_types', true);
        $this->forge->dropTable('lead_types', true);
    }
}
