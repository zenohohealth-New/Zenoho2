/**
 * Regression: the sign-in screen must accept the code Supabase actually issues.
 *
 * Found before any device run, by reading the project's auth config rather than
 * trusting the app's assumption. The project has `otp_length = 8`; the screen
 * hard-coded six digits AND capped the text input at six characters, so the
 * correct code could not even be typed. Every sign-in attempt would have failed,
 * and each failure costs one of a very small number of emails per hour.
 *
 * OTP length is a per-project *setting*, not a constant. A client stricter than
 * the server about a value the server owns is a bug waiting for a config change,
 * so the app accepts the full range Supabase supports and lets the server decide.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCREEN = new URL('../app/src/ui/SignInScreen.tsx', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

const source = readFileSync(SCREEN, 'utf8');

/** The pattern the screen actually uses, lifted from the source. */
function otpPattern(): RegExp {
  const m = /const OTP_RE = (\/.+\/);/.exec(source);
  if (!m) throw new Error('OTP_RE is no longer a regex literal in SignInScreen');
  // eslint-disable-next-line no-eval
  return eval(m[1]) as RegExp;
}

describe('sign-in code format', () => {
  const re = otpPattern();

  it('accepts the 8-digit code this project issues', () => {
    expect(re.test('12345678')).toBe(true);
  });

  it('accepts 6 digits too, since otp_length is a project setting', () => {
    expect(re.test('123456')).toBe(true);
  });

  it('accepts the longest Supabase supports', () => {
    expect(re.test('1234567890')).toBe(true);
  });

  it('still rejects nonsense', () => {
    expect(re.test('12345')).toBe(false);
    expect(re.test('abcdefgh')).toBe(false);
    expect(re.test('')).toBe(false);
    expect(re.test('1234 5678')).toBe(false);
  });

  it('is a regex literal, not built from a template string', () => {
    // `\\d` inside a template literal loses its backslash and silently becomes
    // /^d{6,10}$/, which matches "dddddd" and no real code at all.
    expect(source).toMatch(/const OTP_RE = \/\^\\d\{\d+,\d+\}\$\//);
    expect(source).not.toMatch(/OTP_RE = new RegExp\(`/);
  });

  it('does not cap the input below the longest accepted code', () => {
    // maxLength={6} was the other half of the defect: the 8th digit could not be
    // typed even once the validator accepted it.
    expect(source).toMatch(/maxLength=\{OTP_MAX\}/);
    expect(source).not.toMatch(/maxLength=\{6\}/);
  });

  it('no longer promises a six-digit code in the copy', () => {
    expect(source).not.toMatch(/six-digit/);
  });
});
