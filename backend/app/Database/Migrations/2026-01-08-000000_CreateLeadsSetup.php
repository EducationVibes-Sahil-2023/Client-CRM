<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Leads setup: add conversion type to lead statuses, and add configurable
 * marketing types and lead sources (each with colour, sequence, status).
 */
class CreateLeadsSetup extends Migration
{
    public function up()
    {
        // Lead statuses gain a conversion type (open / won / lost / nurturing).
        $this->forge->addColumn('lead_statuses', [
            'conversion_type' => ['type' => 'VARCHAR', 'constraint' => 30, 'default' => 'open', 'after' => 'color'],
        ]);

        // Marketing types.
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
        $this->forge->createTable('marketing_types');

        // Lead sources, each optionally tied to a marketing type.
        $this->forge->addField([
            'id'                => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'name'              => ['type' => 'VARCHAR', 'constraint' => 100],
            'color'             => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'indigo'],
            'sequence'          => ['type' => 'INT', 'constraint' => 11, 'default' => 0],
            'marketing_type_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'enabled'           => ['type' => 'TINYINT', 'constraint' => 1, 'default' => 1],
            'created_at'        => ['type' => 'DATETIME', 'null' => true],
            'updated_at'        => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('lead_sources');
    }

    public function down()
    {
        $this->forge->dropTable('lead_sources', true);
        $this->forge->dropTable('marketing_types', true);
        $this->forge->dropColumn('lead_statuses', 'conversion_type');
    }
}
