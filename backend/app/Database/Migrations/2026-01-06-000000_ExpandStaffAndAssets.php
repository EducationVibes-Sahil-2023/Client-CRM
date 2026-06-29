<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Expand client_staff with HR/profile fields, add admin-managed lookup lists
 * (lead type, office location, department), and the asset-management module
 * (assets + allocations).
 */
class ExpandStaffAndAssets extends Migration
{
    public function up()
    {
        // --- extra staff fields ---
        $this->forge->addColumn('client_staff', [
            'avatar'             => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true, 'after' => 'phone'],
            'emp_code'           => ['type' => 'VARCHAR', 'constraint' => 50, 'null' => true],
            'alt_phone'          => ['type' => 'VARCHAR', 'constraint' => 50, 'null' => true],
            'lead_type_id'       => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'office_location_id' => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'department_id'      => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'facebook'           => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'linkedin'           => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'skype'              => ['type' => 'VARCHAR', 'constraint' => 100, 'null' => true],
            'email_signature'    => ['type' => 'TEXT', 'null' => true],
            'password'           => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
        ]);

        // --- admin-managed lookup lists ---
        $this->forge->addField([
            'id'         => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'category'   => ['type' => 'VARCHAR', 'constraint' => 50],
            'name'       => ['type' => 'VARCHAR', 'constraint' => 255],
            'created_at' => ['type' => 'DATETIME', 'null' => true],
            'updated_at' => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['client_id', 'category']);
        $this->forge->createTable('client_lookups');

        // --- assets ---
        $this->forge->addField([
            'id'                  => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'           => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'asset_code'          => ['type' => 'VARCHAR', 'constraint' => 50, 'null' => true],
            'name'                => ['type' => 'VARCHAR', 'constraint' => 255],
            'quantity'            => ['type' => 'INT', 'constraint' => 11, 'default' => 1],
            'unit'                => ['type' => 'VARCHAR', 'constraint' => 50, 'null' => true],
            'series_model'        => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'asset_group'         => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'managed_by'          => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'null' => true],
            'asset_location'      => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'purchase_date'       => ['type' => 'DATE', 'null' => true],
            'warranty_months'     => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'unit_price'          => ['type' => 'DECIMAL', 'constraint' => '12,2', 'null' => true],
            'depreciation_months' => ['type' => 'INT', 'constraint' => 11, 'null' => true],
            'supplier_name'       => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'supplier_phone'      => ['type' => 'VARCHAR', 'constraint' => 50, 'null' => true],
            'supplier_address'    => ['type' => 'TEXT', 'null' => true],
            'description'         => ['type' => 'TEXT', 'null' => true],
            'attachment'          => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'status'              => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'available'],
            'created_at'          => ['type' => 'DATETIME', 'null' => true],
            'updated_at'          => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey('client_id');
        $this->forge->createTable('assets');

        // --- asset allocations (assign / revoke history) ---
        $this->forge->addField([
            'id'            => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true, 'auto_increment' => true],
            'client_id'     => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'asset_id'      => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'staff_id'      => ['type' => 'INT', 'constraint' => 11, 'unsigned' => true],
            'allocated_at'  => ['type' => 'DATETIME', 'null' => true],
            'revoked_at'    => ['type' => 'DATETIME', 'null' => true],
            'status'        => ['type' => 'VARCHAR', 'constraint' => 20, 'default' => 'allocated'],
            'notes'         => ['type' => 'TEXT', 'null' => true],
            'created_at'    => ['type' => 'DATETIME', 'null' => true],
            'updated_at'    => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->addKey(['client_id', 'asset_id']);
        $this->forge->createTable('asset_allocations');
    }

    public function down()
    {
        $this->forge->dropTable('asset_allocations', true);
        $this->forge->dropTable('assets', true);
        $this->forge->dropTable('client_lookups', true);
        foreach (['avatar', 'emp_code', 'alt_phone', 'lead_type_id', 'office_location_id', 'department_id', 'facebook', 'linkedin', 'skype', 'email_signature', 'password'] as $col) {
            $this->forge->dropColumn('client_staff', $col);
        }
    }
}
