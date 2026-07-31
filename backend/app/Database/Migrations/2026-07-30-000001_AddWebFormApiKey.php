<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-form API key for Web-to-Lead — lets external systems (Postman, Zapier,
 * a website backend) POST submissions to /public/forms/{token} authenticated by
 * an `X-Api-Key` header instead of the embedded browser form. Lives in each
 * client DB (mirrored via `php spark tenants:sync`; `web_forms` is in TenantSchema).
 */
class AddWebFormApiKey extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('api_key', 'web_forms')) {
            $this->forge->addColumn('web_forms', [
                'api_key' => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true, 'after' => 'token'],
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('api_key', 'web_forms')) {
            $this->forge->dropColumn('web_forms', 'api_key');
        }
    }
}
