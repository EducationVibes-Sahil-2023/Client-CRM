<?php

namespace App\Libraries;

use App\Models\AppSettingModel;

/**
 * Sends outgoing email through Gmail SMTP using the same account + App Password
 * configured for the IMAP inbox (app_settings: gmail_user, gmail_app_password).
 *
 * Returns a structured result so callers can show the exact failure reason
 * instead of silently swallowing it.
 */
class MailerService
{
    private string $user;
    private string $pass;

    public function __construct(?array $override = null)
    {
        $map = $override ?? $this->loadSettings();
        $this->user = trim((string) ($map['gmail_user'] ?? env('gmail.user', '')));
        // App passwords are displayed with spaces; SMTP wants them stripped.
        $this->pass = str_replace(' ', '', (string) ($map['gmail_app_password'] ?? env('gmail.appPassword', '')));
    }

    private function loadSettings(): array
    {
        try {
            return (new AppSettingModel())->getMap();
        } catch (\Throwable $e) {
            return [];
        }
    }

    public function isConfigured(): bool
    {
        return $this->user !== '' && $this->pass !== '';
    }

    public function fromAddress(): string
    {
        return $this->user;
    }

    /**
     * Send an HTML email.
     *
     * @return array{ok: bool, error?: string}
     */
    public function send(string $to, string $subject, string $html, ?string $fromName = null): array
    {
        if (! $this->isConfigured()) {
            return ['ok' => false, 'error' => 'Email is not configured. Add a Gmail address and App Password under Integrations → Email.'];
        }
        if (trim($to) === '' || ! filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return ['ok' => false, 'error' => 'The recipient email address is invalid.'];
        }

        $email = \Config\Services::email();
        $email->initialize([
            'protocol'    => 'smtp',
            'SMTPHost'    => 'smtp.gmail.com',
            'SMTPUser'    => $this->user,
            'SMTPPass'    => $this->pass,
            'SMTPPort'    => 587,
            'SMTPCrypto'  => 'tls',
            'SMTPTimeout' => 20,
            'mailType'    => 'html',
            'charset'     => 'UTF-8',
            'newline'     => "\r\n",
            'CRLF'        => "\r\n",
            'wordWrap'    => true,
        ]);
        $email->setFrom($this->user, ($fromName ?? '') !== '' ? $fromName : $this->user);
        $email->setReplyTo($this->user, ($fromName ?? '') !== '' ? $fromName : $this->user);
        $email->setTo($to);
        $email->setSubject($subject !== '' ? $subject : '(no subject)');
        $email->setMessage($html !== '' ? $html : ' ');

        try {
            if ($email->send(false)) {
                return ['ok' => true];
            }

            return ['ok' => false, 'error' => $this->cleanError($email->printDebugger(['headers']))];
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => $this->cleanError($e->getMessage())];
        }
    }

    /** Collapse the verbose SMTP debug dump into a short, readable reason. */
    private function cleanError(string $debug): string
    {
        $text = trim(preg_replace('/\s+/', ' ', strip_tags($debug)) ?? '');
        // Surface the most useful line (the SMTP server's own message) if present.
        if (preg_match('/(5\d\d[- ].*?)(?: Unable| The following| $)/', $text, $m)) {
            $text = trim($m[1]);
        }

        return $text !== '' ? mb_substr($text, 0, 400) : 'SMTP send failed (no details returned).';
    }
}
