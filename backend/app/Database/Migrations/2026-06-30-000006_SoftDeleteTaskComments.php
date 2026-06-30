<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Make task comments soft-deletable. Previously TaskCommentModel had no
 * deleted_at column, so deleting a comment was a permanent hard delete — the
 * only place in the app that destroyed user content. This adds the column so
 * the model can flag deleted_at instead (matching every other module).
 *
 * Idempotent + additive (column added only if missing), so it's safe to re-run.
 * After migrating, run `php spark tenants:sync` to mirror the column to every
 * client DB (or `php spark db:upgrade`, which does both). TenantSchema mirrors
 * the main-DB structure, so the new column rolls out to all tenants on sync.
 */
class SoftDeleteTaskComments extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('deleted_at', 'task_comments')) {
            $this->forge->addColumn('task_comments', [
                'deleted_at' => ['type' => 'DATETIME', 'null' => true, 'after' => 'created_at'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('deleted_at', 'task_comments')) {
            $this->forge->dropColumn('task_comments', 'deleted_at');
        }
    }
}
