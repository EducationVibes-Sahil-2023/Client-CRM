<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-office working hours (JSON): the weekly schedule that drives the
 * first-response SLA — each weekday has an open/close time and an "off" flag.
 * Stored on the office because a "team" is an office location. Additive column,
 * rolled out to every client DB via `php spark tenants:sync`.
 */
class AddOfficeWorkingHours extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('working_hours', 'office_locations')) {
            $this->forge->addColumn('office_locations', [
                'working_hours' => ['type' => 'TEXT', 'null' => true, 'after' => 'map_url'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('working_hours', 'office_locations')) {
            $this->forge->dropColumn('office_locations', 'working_hours');
        }
    }
}
