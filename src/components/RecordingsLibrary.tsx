import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatTimer } from '../settings';
import {
  type AppRecording,
  type RecordingMarker,
  deleteRecording,
  formatRecordingStamp,
  listRecordings,
  normalizeMarkers,
  saveRecordingRangeToPhotos,
  saveRecordingToPhotos,
  updateRecordingMarkers,
} from '../recordings';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function RecordingsLibrary({ visible, onClose }: Props) {
  const [items, setItems] = useState<AppRecording[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<AppRecording | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listRecordings());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      void refresh();
      setActive(null);
    }
  }, [visible, refresh]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        {active ? (
          <RecordingPlayer
            recording={active}
            onBack={async () => {
              setActive(null);
              await refresh();
            }}
          />
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.title}>Recordings</Text>
              <Pressable onPress={onClose}>
                <Text style={styles.link}>Close</Text>
              </Pressable>
            </View>
            {loading ? (
              <ActivityIndicator color="#fafafa" style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                  <Text style={styles.empty}>No in-app recordings yet. Rec takes land here.</Text>
                }
                renderItem={({ item }) => (
                  <Pressable style={styles.row} onPress={() => setActive(item)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{formatRecordingStamp(item.createdAt)}</Text>
                      <Text style={styles.rowMeta}>
                        {formatTimer(item.durationSec)} · {item.markers.length} markers
                        {item.photosAssetId ? ' · in Photos' : ''}
                      </Text>
                    </View>
                    <Text style={styles.chev}>›</Text>
                  </Pressable>
                )}
              />
            )}
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function RecordingPlayer({
  recording,
  onBack,
}: {
  recording: AppRecording;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<AppRecording>(recording);
  const [fromId, setFromId] = useState('begin');
  const [toId, setToId] = useState('end');
  const [busy, setBusy] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');

  const uri = draft.localPath.startsWith('file://')
    ? draft.localPath
    : `file://${draft.localPath}`;

  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  const { isPlaying } = useEvent(player, 'playingChange', {
    isPlaying: player.playing,
  });

  const sorted = useMemo(
    () => normalizeMarkers(draft.markers, draft.durationSec),
    [draft.markers, draft.durationSec],
  );

  async function persistMarkers(next: RecordingMarker[]) {
    const updated = await updateRecordingMarkers(draft.id, next);
    if (updated) {
      setDraft(updated);
    }
  }

  function addMarkerAtPlayhead() {
    const sec = Math.floor(player.currentTime);
    const next = normalizeMarkers(
      [
        ...draft.markers.filter((m) => !m.locked),
        {
          id: `m-${Date.now()}`,
          sec,
          label: labelDraft.trim() || `Mark ${draft.markers.length}`,
        },
      ],
      draft.durationSec,
    );
    setLabelDraft('');
    void persistMarkers(next);
  }

  function moveMarker(id: string, delta: number) {
    const next = draft.markers.map((m) =>
      m.id === id && !m.locked
        ? { ...m, sec: Math.max(0, Math.min(draft.durationSec, m.sec + delta)) }
        : m,
    );
    void persistMarkers(next);
  }

  function removeMarker(id: string) {
    const target = draft.markers.find((m) => m.id === id);
    if (!target || target.locked) {
      return;
    }
    void persistMarkers(draft.markers.filter((m) => m.id !== id));
  }

  async function saveWhole() {
    setBusy(true);
    try {
      const assetId = await saveRecordingToPhotos(draft);
      setDraft((current) => ({ ...current, photosAssetId: assetId }));
      Alert.alert('Saved', 'Full take saved to Photos.');
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  async function saveRange() {
    const from = sorted.find((m) => m.id === fromId);
    const to = sorted.find((m) => m.id === toId);
    if (!from || !to || to.sec <= from.sec) {
      Alert.alert('Pick markers', 'Choose a start marker before an end marker.');
      return;
    }
    setBusy(true);
    try {
      const result = await saveRecordingRangeToPhotos(draft, from.sec, to.sec);
      setDraft((current) => ({ ...current, photosAssetId: result.assetId }));
      Alert.alert(
        'Saved to Photos',
        result.clipped
          ? `Full take saved. Playback range ${formatTimer(from.sec)} → ${formatTimer(to.sec)} is marked in-app (Photos gets the full file so you can trim there if needed).`
          : 'Full take saved to Photos.',
      );
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete recording?',
      draft.photosAssetId
        ? 'Also delete the Photos copy of this take?'
        : 'Remove this take from the app library?',
      draft.photosAssetId
        ? [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'App only',
              onPress: () => void runDelete(false),
            },
            {
              text: 'App + Photos',
              style: 'destructive',
              onPress: () => void runDelete(true),
            },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => void runDelete(false),
            },
          ],
    );
  }

  async function runDelete(photosToo: boolean) {
    setBusy(true);
    try {
      await deleteRecording(draft, photosToo);
      onBack();
    } catch (error) {
      Alert.alert('Delete failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.playerRoot}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.link}>‹ Back</Text>
        </Pressable>
        <Text style={styles.titleSmall}>{formatRecordingStamp(draft.createdAt)}</Text>
        <View style={{ width: 48 }} />
      </View>

      <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />

      <View style={styles.controls}>
        <Pressable
          style={styles.btn}
          onPress={() => {
            if (isPlaying) {
              player.pause();
            } else {
              player.play();
            }
          }}
        >
          <Text style={styles.btnLabel}>{isPlaying ? 'Pause' : 'Play'}</Text>
        </Pressable>
        <Pressable
          style={styles.btn}
          onPress={() => {
            player.currentTime = 0;
          }}
        >
          <Text style={styles.btnLabel}>Start</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Markers</Text>
      <View style={styles.markerAdd}>
        <TextInput
          style={styles.input}
          value={labelDraft}
          onChangeText={setLabelDraft}
          placeholder="New mark label"
          placeholderTextColor="#71717a"
        />
        <Pressable style={styles.btn} onPress={addMarkerAtPlayhead}>
          <Text style={styles.btnLabel}>Add at playhead</Text>
        </Pressable>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(m) => m.id}
        style={{ flexGrow: 0, maxHeight: 180 }}
        renderItem={({ item }) => (
          <View style={styles.markerRow}>
            <Pressable
              onPress={() => {
                player.currentTime = item.sec;
              }}
              style={{ flex: 1 }}
            >
              <Text style={styles.markerText}>
                {item.label ?? item.id} · {formatTimer(item.sec)}
                {item.locked ? ' · fixed' : ''}
              </Text>
            </Pressable>
            {!item.locked ? (
              <View style={styles.markerActions}>
                <Pressable onPress={() => moveMarker(item.id, -1)}>
                  <Text style={styles.link}>-1s</Text>
                </Pressable>
                <Pressable onPress={() => moveMarker(item.id, 1)}>
                  <Text style={styles.link}>+1s</Text>
                </Pressable>
                <Pressable onPress={() => removeMarker(item.id)}>
                  <Text style={styles.danger}>Del</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      />

      <Text style={styles.section}>Save range</Text>
      <View style={styles.rangeRow}>
        <Text style={styles.meta}>From</Text>
        {sorted.map((m) => (
          <Pressable
            key={`from-${m.id}`}
            style={[styles.chip, fromId === m.id && styles.chipOn]}
            onPress={() => setFromId(m.id)}
          >
            <Text style={[styles.chipLabel, fromId === m.id && styles.chipLabelOn]}>
              {m.label ?? m.id}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.rangeRow}>
        <Text style={styles.meta}>To</Text>
        {sorted.map((m) => (
          <Pressable
            key={`to-${m.id}`}
            style={[styles.chip, toId === m.id && styles.chipOn]}
            onPress={() => setToId(m.id)}
          >
            <Text style={[styles.chipLabel, toId === m.id && styles.chipLabelOn]}>
              {m.label ?? m.id}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.footer}>
        <Pressable style={styles.btn} disabled={busy} onPress={() => void saveWhole()}>
          <Text style={styles.btnLabel}>Save whole to Photos</Text>
        </Pressable>
        <Pressable style={styles.btn} disabled={busy} onPress={() => void saveRange()}>
          <Text style={styles.btnLabel}>Save From→To to Photos</Text>
        </Pressable>
        <Pressable style={styles.dangerBtn} disabled={busy} onPress={confirmDelete}>
          <Text style={styles.danger}>Delete</Text>
        </Pressable>
      </View>
      {busy ? <ActivityIndicator color="#fafafa" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { color: '#fafafa', fontSize: 22, fontWeight: '700' },
  titleSmall: { color: '#e4e4e7', fontSize: 13, fontWeight: '600' },
  link: { color: '#a1a1aa', fontSize: 15, fontWeight: '600' },
  list: { padding: 16, gap: 8 },
  empty: { color: '#71717a', textAlign: 'center', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  rowTitle: { color: '#fafafa', fontSize: 15, fontWeight: '600' },
  rowMeta: { color: '#71717a', fontSize: 12, marginTop: 4 },
  chev: { color: '#52525b', fontSize: 22 },
  playerRoot: { flex: 1, paddingBottom: 12 },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
  },
  controls: { flexDirection: 'row', gap: 8, padding: 12 },
  btn: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  btnLabel: { color: '#fafafa', fontWeight: '600', fontSize: 13 },
  section: {
    color: '#a1a1aa',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 12,
    marginTop: 8,
    marginBottom: 6,
  },
  markerAdd: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3f3f46',
    borderRadius: 10,
    color: '#fafafa',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
  },
  markerText: { color: '#e4e4e7', fontSize: 13 },
  markerActions: { flexDirection: 'row', gap: 12 },
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginBottom: 6,
  },
  meta: { color: '#71717a', fontSize: 12, marginRight: 4 },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3f3f46',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: '#fafafa', borderColor: '#fafafa' },
  chipLabel: { color: '#e4e4e7', fontSize: 12, fontWeight: '600' },
  chipLabelOn: { color: '#0a0a0a' },
  footer: { padding: 12, gap: 8 },
  dangerBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  danger: { color: '#fca5a5', fontWeight: '700' },
});
