/**
 * Spec §11 screen 4 — set the commitment.
 *
 * T-002 allows free editing; D-006 restricts edits to a cycle boundary, which
 * cannot exist before cycles do (T-004). The copy says what the witness will and
 * will not see, per §11, even though there is no witness yet — the promise the
 * member is making is the same one, and it should not change wording later.
 *
 * Copy rule (spec §11): no health claim anywhere on this screen.
 */
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Commitment, ToleranceMin } from '../derive/types';
import { TOLERANCE_CHOICES } from '../storage/commitmentStore';
import { colors, hhmm, t } from './theme';

const STEP_MIN = 15;

interface Props {
  readonly initial: Commitment;
  readonly saving: boolean;
  readonly onSave: (c: Commitment) => void;
  readonly onCancel?: () => void;
}

export function CommitmentScreen({ initial, saving, onSave, onCancel }: Props) {
  const [bed, setBed] = useState(initial.bedTargetMin);
  const [wake, setWake] = useState(initial.wakeTargetMin);
  const [tol, setTol] = useState<ToleranceMin>(initial.toleranceMin);

  const nudge = (v: number, by: number) => (((v + by) % 1440) + 1440) % 1440;

  return (
    <ScrollView style={t.screen} contentContainerStyle={t.content}>
      <Text style={t.h1}>Your promise</Text>
      <Text style={t.sub}>
        One sleep window, kept or missed, worked out from your watch. Research
        associates a regular sleep window with a range of long-term outcomes; Zenoho
        only tracks whether you kept the window you chose.
      </Text>

      <Text style={t.h2}>Asleep by</Text>
      <TimeField value={bed} onChange={setBed} nudge={nudge} />

      <Text style={t.h2}>Awake by</Text>
      <TimeField value={wake} onChange={setWake} nudge={nudge} />

      <Text style={t.h2}>Tolerance</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {TOLERANCE_CHOICES.map((choice) => {
          const active = choice === tol;
          return (
            <Pressable
              key={choice}
              onPress={() => setTol(choice)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: active ? colors.accent : colors.card,
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.line,
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '600',
                  color: active ? '#ffffff' : colors.inkSoft,
                }}
              >
                {choice}m
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={t.sub}>
        A night counts as kept when both ends land inside {tol} minutes of your
        targets — so {hhmm(bed - tol)}–{hhmm(bed + tol)} and {hhmm(wake - tol)}–
        {hhmm(wake + tol)}.
      </Text>

      <View style={[t.notice, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line }]}>
        <Text style={t.noticeTitle}>What a witness will see</Text>
        <Text style={t.noticeBody}>
          Kept, missed, or no data — and nothing else. Not your times, not how close
          you were, not your heart rate. Those stay on this phone.
        </Text>
      </View>

      <Pressable
        style={[t.button, saving && { opacity: 0.6 }]}
        disabled={saving}
        onPress={() => onSave({ bedTargetMin: bed, wakeTargetMin: wake, toleranceMin: tol })}
      >
        <Text style={t.buttonText}>{saving ? 'Saving…' : 'Save promise'}</Text>
      </Pressable>

      {onCancel && (
        <Pressable style={t.buttonGhost} onPress={onCancel} disabled={saving}>
          <Text style={t.buttonGhostText}>Cancel</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function TimeField({
  value,
  onChange,
  nudge,
}: {
  value: number;
  onChange: (v: number) => void;
  nudge: (v: number, by: number) => number;
}) {
  return (
    <View style={[t.card, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
      <Stepper label="−15" onPress={() => onChange(nudge(value, -STEP_MIN))} />
      <Text style={{ fontSize: 34, fontWeight: '600', color: colors.ink, letterSpacing: 1 }}>
        {hhmm(value)}
      </Text>
      <Stepper label="+15" onPress={() => onChange(nudge(value, STEP_MIN))} />
    </View>
  );
}

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label === '−15' ? 'fifteen minutes earlier' : 'fifteen minutes later'}
      hitSlop={12}
      style={{
        width: 56,
        height: 44,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.inkSoft }}>{label}</Text>
    </Pressable>
  );
}
