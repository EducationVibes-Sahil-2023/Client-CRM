<?php

namespace App\Libraries;

/**
 * Sends a newly-created user their login credentials. Used when a super admin
 * creates a client (platform Gmail) or a client admin creates staff (the
 * client's own Gmail, via an override map). Sending is best-effort: if email
 * isn't configured the account is still created — we just report it wasn't sent.
 */
class CredentialMailer
{
    /**
     * @param array|null $gmailOverride Per-client Gmail config, or null for the platform's.
     * @return array{sent:bool,error:?string}
     */
    public static function send(?array $gmailOverride, string $name, string $email, string $password, string $loginUrl): array
    {
        if (trim($email) === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['sent' => false, 'error' => 'The recipient email address is invalid.'];
        }

        $mailer = new MailerService($gmailOverride);
        if (! $mailer->isConfigured()) {
            return ['sent' => false, 'error' => 'Email is not configured.'];
        }

        $who     = trim($name) !== '' ? esc($name) : 'there';
        $login   = esc($loginUrl);
        $subject = 'Your CRM login details';
        $html    =
            '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.6">'
            . '<p>Hi ' . $who . ',</p>'
            . '<p>An account has been created for you. Here are your login details:</p>'
            . '<table style="border-collapse:collapse;margin:12px 0">'
            . '<tr><td style="padding:4px 12px 4px 0;color:#64748b">Email</td><td style="padding:4px 0;font-weight:600">' . esc($email) . '</td></tr>'
            . '<tr><td style="padding:4px 12px 4px 0;color:#64748b">Password</td><td style="padding:4px 0;font-weight:600">' . esc($password) . '</td></tr>'
            . '</table>'
            . '<p><a href="' . $login . '" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Sign in</a></p>'
            . '<p style="color:#64748b">Or go to: <a href="' . $login . '">' . $login . '</a></p>'
            . '<p style="color:#b45309">For your security, please change this password after your first sign-in.</p>'
            . '</div>';

        $r = $mailer->send($email, $subject, $html);

        return ['sent' => ! empty($r['ok']), 'error' => ! empty($r['ok']) ? null : ($r['error'] ?? 'The email could not be delivered.')];
    }
}
