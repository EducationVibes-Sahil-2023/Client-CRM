<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * First-response SLA stored on the lead: the working-hours time from assignment
 * to the first connected call by the assigned user. `first_response_seconds` is
 * the elapsed working seconds (10 when the connect lands on a weekend/holiday —
 * off-day credit), `first_response_at` the call time. Stamped once, backfilled by
 * `php spark leads:resync`. Additive → tenants:sync.
 */
class AddLeadFirstResponse extends Migration
{
    public function up()
    {
        $fields = [];
        if (! $this->db->fieldExists('first_response_seconds', 'leads')) {
            $fields['first_response_seconds'] = ['type' => 'INT', 'constraint' => 11, 'null' => true, 'after' => 'assigned_date'];
        }
        if (! $this->db->fieldExists('first_response_at', 'leads')) {
            $fields['first_response_at'] = ['type' => 'DATETIME', 'null' => true, 'after' => 'first_response_seconds'];
        }
        if ($fields) {
            $this->forge->addColumn('leads', $fields);
        }
    }

    public function down()
    {
        foreach (['first_response_seconds', 'first_response_at'] as $c) {
            if ($this->db->fieldExists($c, 'leads')) {
                $this->forge->dropColumn('leads', $c);
            }
        }
    }
}
