<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * The client's OWN applicant table — a client-defined entity whose columns the
 * client designs (kept in the `applicant_columns` setting). Row values live in a
 * JSON `data` column; `search_blob` is a flattened copy for LIKE search. Lives in
 * each client DB (mirrored via `php spark tenants:sync`; in TenantSchema::TABLES).
 */
class CreateApplicants extends Migration
{
    public function up()
    {
        if ($this->db->tableExists('applicants')) {
            return;
        }

        $this->forge->addField([
            'id'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'   => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'data'        => ['type' => 'MEDIUMTEXT', 'null' => true],   // JSON: columnKey => value
            'search_blob' => ['type' => 'TEXT', 'null' => true],         // flattened values for LIKE
            'created_at'  => ['type' => 'DATETIME', 'null' => true],
            'updated_at'  => ['type' => 'DATETIME', 'null' => true],
            'deleted_at'  => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('applicants');
    }

    public function down()
    {
        $this->forge->dropTable('applicants', true);
    }
}
