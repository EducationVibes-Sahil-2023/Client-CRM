<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Office locations gain geo details: pincode, latitude/longitude coordinates,
 * and a Google Maps link. Applied to the main DB; `php spark tenants:sync`
 * rolls the columns out to every client database.
 */
class OfficeLocationGeo extends Migration
{
    public function up()
    {
        $add = [];
        if (! $this->db->fieldExists('pincode', 'office_locations')) {
            $add['pincode'] = ['type' => 'VARCHAR', 'constraint' => 20, 'null' => true, 'after' => 'city'];
        }
        if (! $this->db->fieldExists('latitude', 'office_locations')) {
            $add['latitude'] = ['type' => 'DECIMAL', 'constraint' => '10,7', 'null' => true];
        }
        if (! $this->db->fieldExists('longitude', 'office_locations')) {
            $add['longitude'] = ['type' => 'DECIMAL', 'constraint' => '10,7', 'null' => true];
        }
        if (! $this->db->fieldExists('map_url', 'office_locations')) {
            $add['map_url'] = ['type' => 'VARCHAR', 'constraint' => 500, 'null' => true];
        }
        if ($add) {
            $this->forge->addColumn('office_locations', $add);
        }
    }

    public function down()
    {
        foreach (['pincode', 'latitude', 'longitude', 'map_url'] as $col) {
            if ($this->db->fieldExists($col, 'office_locations')) {
                $this->forge->dropColumn('office_locations', $col);
            }
        }
    }
}
