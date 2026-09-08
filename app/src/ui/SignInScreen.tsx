/**
 * Sign in with an email one-time code (D-032, T-003 deliverable 3).
 *
 * Two steps: email, then the 6-digit code. No password, no magic link, no OAuth.
 *
 * Copy rule (spec §11): no health claim, and D-027 — the copy has to be honest
 * that this is where data starts leaving the phone, because up to now none did.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { colors, t } from './theme';

type Step = 'email' | 'code';

interface Props {
  readonly onSendCode: (email: string) => Promise<void>;
  readonly onVerify: (email: string, code: string) => Promise<void>;
  readonly onSkip?: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInScreen({ onSendCode, onVerify, onSkip }: Props) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError('That does not look like an email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSendCode(email.trim());
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError('The code is six digits.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onVerify(email.trim(), code.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={t.screen} contentContainerStyle={t.content}>
      <Text style={t.h1}>{step === 'email' ? 'Sign in' : 'Check your email'}</Text>

      {step === 'email' ? (
        <>
          <Text style={t.sub}>
            Your email is used to sign in and to keep your nights on your own account.
            No password to remember — we send a six-digit code.
          </Text>

          <Text style={t.h2}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.inkMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            style={[t.card, { fontSize: 17, color: colors.ink }]}
          />

          <View style={[t.notice, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line }]}>
            <Text style={t.noticeTitle}>What leaves this phone</Text>
            <Text style={t.noticeBody}>
              Only whether each night was kept, missed, or had no data — plus how far
              off you were, in minutes, which nobody else can see. Your sleep times
              and your heart rate never leave this phone. Your watch sends them to
              Health Connect; Zenoho reads them here and works out the answer here.
            </Text>
          </View>

          <Pressable style={[t.button, busy && { opacity: 0.6 }]} onPress={send} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.buttonText}>Send me a code</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={t.sub}>
            We sent a six-digit code to {email}. It can take a minute, and it
            sometimes lands in spam.
          </Text>

          <Text style={t.h2}>Code</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={colors.inkMuted}
            keyboardType="number-pad"
            maxLength={6}
            textContentType="oneTimeCode"
            style={[t.card, { fontSize: 24, letterSpacing: 6, color: colors.ink }]}
          />

          <Pressable style={[t.button, busy && { opacity: 0.6 }]} onPress={verify} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.buttonText}>Sign in</Text>}
          </Pressable>

          <Pressable style={t.buttonGhost} onPress={() => { setStep('email'); setCode(''); setError(null); }} disabled={busy}>
            <Text style={t.buttonGhostText}>Use a different email</Text>
          </Pressable>
        </>
      )}

      {error !== null && (
        <View style={t.notice}>
          <Text style={t.noticeBody}>{error}</Text>
        </View>
      )}

      {onSkip && (
        <Pressable style={t.buttonGhost} onPress={onSkip} disabled={busy}>
          <Text style={t.buttonGhostText}>Not now — keep everything on this phone</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
