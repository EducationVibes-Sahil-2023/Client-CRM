<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Per-client API key for the public call-ingest endpoint. An external calling
 * app (IVR / device dialer) can't hold a login session, so it authenticates with
 * this stable key instead; the key identifies which client's database the calls
 * land in. Lives on the main-DB `clients` table (not a tenant table).
 *
 * Idempotent + additive: column added only if missing, then every existing
 * client gets a freshly-generated key. Safe to re-run.
 */
class AddClientCallApiKey extends Migration
{
    public function up()
    {
        if (! $this->db->fieldExists('call_api_key', 'clients')) {
            $this->forge->addColumn('clients', [
                'call_api_key' => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true, 'after' => 'status'],
            ]);
            $this->db->query('CREATE UNIQUE INDEX idx_clients_call_api_key ON clients (call_api_key)');
        }

        // Backfill a key for any client that doesn't have one yet.
        foreach ($this->db->table('clients')->select('id')->where('call_api_key', null)->get()->getResultArray() as $row) {
            $this->db->table('clients')->where('id', $row['id'])->update([
                'call_api_key' => bin2hex(random_bytes(24)),
            ]);
        }
    }

    public function down()
    {
        if ($this->db->fieldExists('call_api_key', 'clients')) {
            $this->forge->dropColumn('clients', 'call_api_key');
        }
    }
}
