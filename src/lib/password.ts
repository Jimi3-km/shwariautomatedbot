/**
 * The password rules, in one place.
 *
 * The sign-in service enforces the same rules (at least 10 characters, with a
 * lower-case letter, a capital and a number), so a password accepted here is
 * accepted there. The extra checks below catch what the service cannot see:
 * a password that is just the email address, or one of the handful that
 * everybody tries first.
 */
export const PASSWORD_MIN_LENGTH = 10;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwerty', 'qwertyuiop',
  'qwerty123', '1234567890', '0123456789', 'letmein', 'welcome', 'welcome1', 'welcome123',
  'iloveyou', 'admin', 'admin123', 'abc123', 'abcdefghij', 'changeme', 'shwari', 'shwari123',
]);

export interface PasswordRule { id: string; label: string; ok: boolean }

export function passwordRules(password: string, email = ''): PasswordRule[] {
  const lower = password.toLowerCase();
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const stripped = lower.replace(/[^a-z0-9]/g, '');
  const guessable =
    COMMON.has(lower) || COMMON.has(stripped) || COMMON.has(stripped.replace(/\d+$/, '')) ||
    (local.length >= 4 && lower.includes(local)) ||
    /^(.)\1+$/.test(password);

  return [
    { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: password.length >= PASSWORD_MIN_LENGTH },
    { id: 'lower', label: 'A lower-case letter', ok: /[a-z]/.test(password) },
    { id: 'upper', label: 'A capital letter', ok: /[A-Z]/.test(password) },
    { id: 'digit', label: 'A number', ok: /\d/.test(password) },
    { id: 'guessable', label: 'Not your email or a common password', ok: password.length > 0 && !guessable },
  ];
}

/** The first rule the password breaks, as a sentence; null when it passes. */
export function passwordProblem(password: string, email = ''): string | null {
  const failed = passwordRules(password, email).find((r) => !r.ok);
  if (!failed) return null;
  if (failed.id === 'guessable') return 'Choose a password that is not your email address or a common password.';
  return `Your password needs: ${failed.label.toLowerCase()}.`;
}
