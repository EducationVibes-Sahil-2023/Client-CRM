<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Records the reminder creator's *staff id* (alongside `user_id`) so edit/delete
 * permission resolves against the reporting hierarchy: a reminder may be edited
 * by its creator, a team leader above them, or an admin (mirrors lead notes).
 *
 * Lives in each client DB (mirrored via `php spark tenants:sync`).
 */
class AddLeadReminderAuthorStaff extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('author_staff_id', 'lead_reminders')) {
            $this->forge->addColumn('lead_reminders', [
                'author_staff_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true, 'after' => 'user_id'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('author_staff_id', 'lead_reminders')) {
            $this->forge->dropColumn('lead_reminders', 'author_staff_id');
        }
    }
}
