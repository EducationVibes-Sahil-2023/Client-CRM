<?php

namespace App\Commands;

use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Minishlink\WebPush\VAPID;

/**
 * Generate a VAPID key pair for Web Push:
 *
 *   php spark push:keys
 *
 * Copy the printed values into .env (vapid.publicKey / vapid.privateKey) and set
 * vapid.subject to a mailto: address. Generate ONCE and reuse — rotating the
 * keys invalidates every existing browser subscription.
 */
class PushKeys extends BaseCommand
{
    protected $group       = 'Push';
    protected $name        = 'push:keys';
    protected $description = 'Generate a VAPID public/private key pair for Web Push.';

    public function run(array $params)
    {
        // EC key creation needs OpenSSL's config; on some Windows/XAMPP setups
        // OPENSSL_CONF isn't set, which makes openssl_pkey_new() fail. Point it at
        // a config if we can find one and it's not already set.
        if (getenv('OPENSSL_CONF') === false || getenv('OPENSSL_CONF') === '') {
            foreach (['C:/xampp/apache/conf/openssl.cnf', '/etc/ssl/openssl.cnf'] as $cnf) {
                if (is_file($cnf)) {
                    putenv('OPENSSL_CONF=' . $cnf);
                    break;
                }
            }
        }

        try {
            $keys = VAPID::createVapidKeys();
        } catch (\Throwable $e) {
            CLI::error('Could not generate keys: ' . $e->getMessage());
            CLI::write('Ensure the PHP openssl + gmp extensions are enabled.', 'yellow');
            CLI::write('On Windows/XAMPP, set OPENSSL_CONF before running, e.g.:', 'yellow');
            CLI::write('  set OPENSSL_CONF=C:\\xampp\\apache\\conf\\openssl.cnf && php spark push:keys', 'yellow');

            return;
        }

        CLI::write('Add these to your .env (generate once, then reuse):', 'cyan');
        CLI::write('');
        CLI::write("vapid.publicKey = '" . $keys['publicKey'] . "'", 'green');
        CLI::write("vapid.privateKey = '" . $keys['privateKey'] . "'", 'green');
        CLI::write("vapid.subject = 'mailto:admin@example.com'", 'green');
    }
}
