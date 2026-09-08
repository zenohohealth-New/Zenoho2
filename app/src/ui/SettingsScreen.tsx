/**
 * Settings (spec §11, T-003 deliverable 8): sign out, export, delete.
 *
 * The "what leaves this phone" paragraph is the point of the screen, not
 * decoration. D-027 exists because the distinction is genuinely unobvious in use:
 * the app looks like it is reading the phone, and it is not.
 *
 * Copy rule (spec §11): no health claim anywhere.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { colors, t } from './theme';

interface Props {
  readonly email: string | null;
  readonly pendingSync: number;
  readonly clockOffsetMin: number | null;
  readonly onSignOut: () => Promise<void>;
  readonly onExport: () => Promise<void>;
  readonly onDelete: () => Promise<void>;
  readonly onSignIn: () => void;
  readonly onClose: () => void;
}

export function SettingsScreen(p: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signedIn = p.email !== null;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete everything?',
      'This removes your account and every night on the server, permanently, and clears this phone. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void run('delete', p.onDelete),
        },
      ],
    );
  };

  return (
    <ScrollView style={t.screen} contentContainerStyle={t.content}>
      <Text style={t.h1}>Settings</Text>
      <Text style={t.sub}>
        {p.email ?? 'Not signed in — everything stays on this phone'}
      </Text>

      <Text style={t.h2}>What leaves this phone</Text>
      <View style={t.card}>
        <Text style={t.body}>
          Your watch sends your sleep and heart rate to Health Connect on this phone.
          Zenoho reads them here, works out whether you kept your promise here, and
          sends only the answer.
        </Text>
        <Text style={[t.body, { marginTop: 10 }]}>
          What goes to the server: the date, whether it was kept, missed or had no
          data, whether your watch was worn, which app the sleep came from, and how
          many minutes off you were.
        </Text>
        <Text style={[t.body, { marginTop: 10 }]}>
          What never goes: the times you fell asleep or woke, any heart-rate reading,
          and your resting heart rate. Those stay on this phone and are deleted after
          45 days.
        </Text>
        <Text style={[t.body, { marginTop: 10, color: colors.inkMuted }]}>
          Zenoho does not read your phone&apos;s own sensors. If your watch is not
          syncing, a night shows as no data rather than being guessed from the phone.
        </Text>
      </View>

      {signedIn && (
        <>
      <Text style={t.h2}>Sync</Text>
      <View style={t.row}>
        <Text style={t.rowLabel}>Nights waiting to upload</Text>
        <Text style={t.rowValue}>{p.pendingSync}</Text>
      </View>
      <View style={t.row}>
        <Text style={t.rowLabel}>This phone&apos;s clock vs the server</Text>
        <Text style={t.rowValue}>
          {p.clockOffsetMin === null ? 'not measured' : `${p.clockOffsetMin >= 0 ? '+' : ''}${p.clockOffsetMin} min`}
        </Text>
      </View>
        </>
      )}

      <Text style={t.h2}>Your account</Text>
      {signedIn ? (
        <>
          <Pressable
            style={t.buttonGhost}
            onPress={() => void run('export', p.onExport)}
            disabled={busy !== null}
          >
            <Text style={t.buttonGhostText}>
              {busy === 'export' ? 'Preparing…' : 'Export my data'}
            </Text>
          </Pressable>

          <Pressable
            style={t.buttonGhost}
            onPress={() => void run('signout', p.onSignOut)}
            disabled={busy !== null}
          >
            <Text style={t.buttonGhostText}>
              {busy === 'signout' ? 'Signing out…' : 'Sign out'}
            </Text>
          </Pressable>

          <Pressable
            style={[t.buttonGhost, { borderColor: colors.missed }]}
            onPress={confirmDelete}
            disabled={busy !== null}
          >
            {busy === 'delete' ? (
              <ActivityIndicator color={colors.missed} />
            ) : (
              <Text style={[t.buttonGhostText, { color: colors.missed }]}>
                Delete my account and all my data
              </Text>
            )}
          </Pressable>
        </>
      ) : (
        <>
          {/* Signed out: exporting, signing out and deleting have nothing to act
              on, so they are not shown at all rather than shown and failing. */}
          <Text style={t.body}>
            You are not signed in. Your nights are being worked out and kept on this
            phone, and nothing is being sent anywhere. Sign in to keep them on your
            own account.
          </Text>
          <Pressable style={t.button} onPress={p.onSignIn} disabled={busy !== null}>
            <Text style={t.buttonText}>Sign in</Text>
          </Pressable>
        </>
      )}

      {error !== null && (
        <View style={t.notice}>
          <Text style={t.noticeBody}>{error}</Text>
        </View>
      )}

      <Pressable style={t.buttonGhost} onPress={p.onClose} disabled={busy !== null}>
        <Text style={t.buttonGhostText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}
