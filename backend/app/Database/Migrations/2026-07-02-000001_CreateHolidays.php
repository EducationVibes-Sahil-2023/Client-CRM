<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Admin-managed holiday calendar (year-wise). A holiday can be global for the
 * client (office_location_id NULL) or scoped to one office. Together with each
 * office's working_hours + weekends, holidays are excluded from the first-response
 * SLA. Lives in each client DB (mirrored via `php spark tenants:sync`).
 */
class CreateHolidays extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('holidays')) {
            return;
        }

        $this->forge->addField([
            'id'                 => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            // NULL = applies to every office; otherwise scoped to one office.
            'office_location_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'holiday_date'       => ['type' => 'DATE'],
            'name'               => ['type' => 'VARCHAR', 'constraint' => 150],
            'created_at'         => ['type' => 'DATETIME', 'null' => true],
            'updated_at'         => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'         => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->addKey('holiday_date');
        $this->forge->createTable('holidays');
    }

    public function down()
    {
        $this->forge->dropTable('holidays', true);
    }
}
