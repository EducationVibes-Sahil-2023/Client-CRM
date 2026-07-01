<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Records the note author's *staff id* (alongside the existing user `author_id`)
 * so edit/delete permission can be resolved against the reporting hierarchy: a
 * note may be edited by its author, by a team leader above them, or by an admin.
 *
 * Lives in each client DB (mirrored via `php spark tenants:sync`).
 */
class AddLeadNoteAuthorStaff extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('author_staff_id', 'lead_notes')) {
            $this->forge->addColumn('lead_notes', [
                'author_staff_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'author_id'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('author_staff_id', 'lead_notes')) {
            $this->forge->dropColumn('lead_notes', 'author_staff_id');
        }
    }
}
