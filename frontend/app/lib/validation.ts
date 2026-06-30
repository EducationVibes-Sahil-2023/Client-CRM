export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export const isPhone = (v: string) =>
  v.trim() === "" || /^[+\d][\d\s()-]{6,}$/.test(v.trim());

export type Errors<T> = Partial<Record<keyof T, string>>;

// ---- Password strength (mirrors backend App\Libraries\PasswordPolicy) --------
// The server is the source of truth and re-checks on save; these helpers drive
// the live requirement checklist + the forced-change gate in the UI.

export const PASSWORD_MIN_LENGTH = 8;

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "qwerty", "qwerty123",
  "12345678", "123456789", "1234567890", "abc12345", "admin123", "welcome1",
  "welcome123", "iloveyou", "letmein", "changeme", "test1234", "p@ssw0rd",
]);

export interface PasswordRule {
  /** Short label shown in the checklist. */
  label: string;
  /** Whether the current password satisfies this rule. */
  met: boolean;
}

/** The full requirement checklist for a candidate password (+ optional email). */
export function passwordRules(password: string, email?: string): PasswordRule[] {
  const local = email ? email.toLowerCase().split("@")[0] : "";
  return [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { label: "A lowercase letter (a–z)", met: /[a-z]/.test(password) },
    { label: "An uppercase letter (A–Z)", met: /[A-Z]/.test(password) },
    { label: "A number (0–9)", met: /\d/.test(password) },
    { label: "A symbol (e.g. ! @ # $ %)", met: /[^A-Za-z0-9]/.test(password) },
    { label: "Not a common, easily-guessed password", met: !COMMON_PASSWORDS.has(password.trim().toLowerCase()) },
    {
      label: "Doesn't contain your email address",
      met: !(local.length >= 3 && password.toLowerCase().includes(local)),
    },
  ];
}

/** True when every requirement is met (i.e. the password is strong). */
export const isStrongPassword = (password: string, email?: string) =>
  passwordRules(password, email).every((r) => r.met);
