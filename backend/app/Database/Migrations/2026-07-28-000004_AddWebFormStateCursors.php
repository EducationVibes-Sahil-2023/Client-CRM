<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-state round-robin cursors for state-wise auto-assignment. A state can now
 * map to MANY counsellors (`state_assignee_map` value = an array of staff ids);
 * this JSON column ({state: cursor}) rotates through that state's counsellors
 * independently of the global pool cursor. Additive → main DB then tenants:sync.
 */
class AddWebFormStateCursors extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('web_forms') && ! $this->db->fieldExists('state_cursors', 'web_forms')) {
            $this->forge->addColumn('web_forms', [
                'state_cursors' => ['type' => 'TEXT', 'null' => true, 'after' => 'state_assignee_map'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('state_cursors', 'web_forms')) {
            $this->forge->dropColumn('web_forms', 'state_cursors');
        }
    }
}
