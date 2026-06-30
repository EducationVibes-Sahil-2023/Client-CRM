<?php

namespace App\Libraries;

/**
 * Central definition of what counts as a "strong" password. Used in two places:
 *
 *  - at login, to detect accounts still on a weak password (so the UI can force
 *    a change before letting them work), and
 *  - on every password change, to reject anything that isn't strong.
 *
 * Keeping the rule here means the login gate and the change form agree exactly.
 * The frontend mirrors this list in lib/validation.ts for live feedback, but the
 * server is the source of truth — a weak password can never be saved.
 */
class PasswordPolicy
{
    public const MIN_LENGTH = 8;

    /** Obvious weak passwords rejected regardless of composition. */
    private const COMMON = [
        'password', 'password1', 'password123', 'passw0rd', 'qwerty', 'qwerty123',
        '12345678', '123456789', '1234567890', 'abc12345', 'admin123', 'welcome1',
        'welcome123', 'iloveyou', 'letmein', 'changeme', 'test1234', 'p@ssw0rd',
    ];

    /** True when the password meets every requirement. */
    public static function isStrong(?string $password, ?string $email = null): bool
    {
        return self::problems((string) $password, $email) === [];
    }

    /**
     * Human-readable list of unmet requirements (empty = strong). The order is
     * the order they're shown to the user.
     *
     * @return list<string>
     */
    public static function problems(string $password, ?string $email = null): array
    {
        $problems = [];

        if (strlen($password) < self::MIN_LENGTH) {
            $problems[] = 'Be at least ' . self::MIN_LENGTH . ' characters long';
        }
        if (! preg_match('/[a-z]/', $password)) {
            $problems[] = 'Include a lowercase letter (a–z)';
        }
        if (! preg_match('/[A-Z]/', $password)) {
            $problems[] = 'Include an uppercase letter (A–Z)';
        }
        if (! preg_match('/\d/', $password)) {
            $problems[] = 'Include a number (0–9)';
        }
        if (! preg_match('/[^A-Za-z0-9]/', $password)) {
            $problems[] = 'Include a symbol (e.g. ! @ # $ %)';
        }
        if (in_array(strtolower(trim($password)), self::COMMON, true)) {
            $problems[] = 'Not be a common, easily-guessed password';
        }
        // Don't let the password just be the email or its name part.
        $local = $email ? strtolower(strtok((string) $email, '@')) : '';
        if ($local !== '' && strlen($local) >= 3 && str_contains(strtolower($password), $local)) {
            $problems[] = 'Not contain your email address';
        }

        return $problems;
    }
}
