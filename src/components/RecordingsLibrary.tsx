import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
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

const DELETE_WIDTH = 84;

function TrashIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7h12Z"
        stroke="#fecaca"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M10 11v6M14 11v6" stroke="#fecaca" strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

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

  function confirmDeleteItem(item: AppRecording) {
    Alert.alert(
      'Delete recording?',
      item.photosAssetId ? 'Also delete the Photos copy?' : 'Remove from BlacRec?',
      item.photosAssetId
        ? [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'App only',
              onPress: () => void runDeleteItem(item, false),
            },
            {
              text: 'App + Photos',
              style: 'destructive',
              onPress: () => void runDeleteItem(item, true),
            },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => void runDeleteItem(item, false),
            },
          ],
    );
  }

  async function runDeleteItem(item: AppRecording, photosToo: boolean) {
    try {
      await deleteRecording(item, photosToo);
      await refresh();
    } catch (error) {
      Alert.alert('Delete failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

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
                ListEmptyComponent={<Text style={styles.empty}>No recordings yet.</Text>}
                renderItem={({ item }) => (
                  <SwipeableRow
                    onOpen={() => setActive(item)}
                    onDelete={() => confirmDeleteItem(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{formatRecordingStamp(item.createdAt)}</Text>
                      <Text style={styles.rowMeta}>
                        {formatTimer(item.durationSec)} · {item.markers.length} markers
                      </Text>
                    </View>
                    <Text style={styles.chev}>›</Text>
                  </SwipeableRow>
                )}
              />
            )}
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function SwipeableRow({
  children,
  onOpen,
  onDelete,
}: {
  children: ReactNode;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.15,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        const next = Math.min(0, Math.max(-DELETE_WIDTH, g.dx));
        x.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const shouldOpen = g.dx < -DELETE_WIDTH / 2 || g.vx < -0.4;
        openRef.current = shouldOpen;
        Animated.spring(x, {
          toValue: shouldOpen ? -DELETE_WIDTH : 0,
          useNativeDriver: true,
          bounciness: 0,
          speed: 20,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.swipeWrap}>
      <Pressable style={styles.deleteAction} onPress={onDelete}>
        <TrashIcon />
      </Pressable>
      <Animated.View
        style={[styles.row, { transform: [{ translateX: x }] }]}
        {...pan.panHandlers}
      >
        <Pressable
          style={styles.rowInner}
          onPress={() => {
            if (openRef.current) {
              openRef.current = false;
              Animated.spring(x, {
                toValue: 0,
                useNativeDriver: true,
                bounciness: 0,
              }).start();
              return;
            }
            onOpen();
          }}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
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
  const [expanded, setExpanded] = useState(false);

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

  // Dedicated handle — VideoView steals pans if handlers sit on the same view.
  const dragPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, g) => {
        if (g.dy > 36 || g.vy > 0.4) {
          setExpanded(true);
        } else if (g.dy < -36 || g.vy < -0.4) {
          setExpanded(false);
        }
      },
    }),
  ).current;

  async function persistMarkers(next: RecordingMarker[]) {
    const updated = await updateRecordingMarkers(draft.id, next);
    if (updated) {
      setDraft(updated);
    }
  }

  function addMarker() {
    const sec = Math.floor(player.currentTime);
    const next = normalizeMarkers(
      [
        ...draft.markers.filter((m) => !m.locked),
        {
          id: `m-${Date.now()}`,
          sec,
          label: formatTimer(sec),
        },
      ],
      draft.durationSec,
    );
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
      Alert.alert('Saved', 'Saved to Photos.');
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
      Alert.alert('Pick markers', 'Start must be before end.');
      return;
    }
    setBusy(true);
    try {
      const result = await saveRecordingRangeToPhotos(draft, from.sec, to.sec);
      setDraft((current) => ({ ...current, photosAssetId: result.assetId }));
      Alert.alert('Saved', 'Saved to Photos.');
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete recording?',
      draft.photosAssetId ? 'Also delete the Photos copy?' : 'Remove from BlacRec?',
      draft.photosAssetId
        ? [
            { text: 'Cancel', style: 'cancel' },
            { text: 'App only', onPress: () => void runDelete(false) },
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

  const winH = Dimensions.get('window').height;

  return (
    <View style={styles.playerRoot}>
      {!expanded ? (
        <View style={styles.header}>
          <Pressable onPress={onBack}>
            <Text style={styles.link}>‹ Back</Text>
          </Pressable>
          <Text style={styles.titleSmall} numberOfLines={1}>
            {formatRecordingStamp(draft.createdAt)}
          </Text>
          <View style={{ width: 48 }} />
        </View>
      ) : null}

      <View
        style={[
          styles.videoWrap,
          expanded && { flex: 1, height: undefined, maxHeight: winH },
        ]}
      >
        <VideoView
          style={styles.video}
          player={player}
          nativeControls={false}
          contentFit="contain"
        />
        <View style={styles.dragHandle} {...dragPan.panHandlers}>
          <View style={styles.dragBar} />
          <Text style={styles.dragHint}>
            {expanded ? 'Drag up to shrink' : 'Drag down for fullscreen'}
          </Text>
        </View>
      </View>

      <View style={[styles.transport, expanded && styles.transportExpanded]}>
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
        <Pressable style={styles.btn} onPress={addMarker}>
          <Text style={styles.btnLabel}>Add marker</Text>
        </Pressable>
      </View>

      {!expanded ? (
        <ScrollView style={styles.editor} contentContainerStyle={{ paddingBottom: 16, gap: 6 }}>
          <Text style={styles.section}>Markers</Text>
          {sorted.map((item) => (
            <View key={item.id} style={styles.markerRow}>
              <Pressable
                onPress={() => {
                  player.currentTime = item.sec;
                }}
                style={{ flex: 1 }}
              >
                <Text style={styles.markerText}>
                  {formatTimer(item.sec)}
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
          ))}

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
                  {formatTimer(m.sec)}
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
                  {formatTimer(m.sec)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.btn} disabled={busy} onPress={() => void saveWhole()}>
            <Text style={styles.btnLabel}>Save whole to Photos</Text>
          </Pressable>
          <Pressable style={styles.btn} disabled={busy} onPress={() => void saveRange()}>
            <Text style={styles.btnLabel}>Save From→To to Photos</Text>
          </Pressable>
          <Pressable style={styles.dangerBtn} disabled={busy} onPress={confirmDelete}>
            <Text style={styles.danger}>Delete</Text>
          </Pressable>
          {busy ? <ActivityIndicator color="#fafafa" /> : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  title: { color: '#fafafa', fontSize: 22, fontWeight: '700' },
  titleSmall: { color: '#e4e4e7', fontSize: 12, fontWeight: '600', flex: 1, textAlign: 'center' },
  link: { color: '#a1a1aa', fontSize: 14, fontWeight: '600' },
  list: { padding: 14, gap: 8 },
  empty: { color: '#71717a', textAlign: 'center', marginTop: 40 },
  swipeWrap: {
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#3f1d1d',
  },
  deleteAction: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 28,
  },
  row: {
    backgroundColor: '#18181b',
    borderRadius: 12,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  rowTitle: { color: '#fafafa', fontSize: 15, fontWeight: '600' },
  rowMeta: { color: '#71717a', fontSize: 12, marginTop: 3 },
  chev: { color: '#52525b', fontSize: 22 },
  playerRoot: { flex: 1 },
  videoWrap: {
    width: '100%',
    height: 180,
    backgroundColor: '#000',
  },
  video: { width: '100%', height: '100%' },
  dragHandle: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 18,
    paddingBottom: 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  dragBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.45)',
    marginBottom: 6,
  },
  dragHint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 10,
  },
  transport: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  transportExpanded: {
    paddingBottom: 18,
    backgroundColor: 'rgba(10,10,10,0.92)',
  },
  editor: { flex: 1, paddingHorizontal: 12 },
  btn: {
    flex: 1,
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  btnLabel: { color: '#fafafa', fontWeight: '600', fontSize: 13 },
  section: {
    color: '#a1a1aa',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
  },
  markerText: { color: '#e4e4e7', fontSize: 13 },
  markerActions: { flexDirection: 'row', gap: 10 },
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    marginBottom: 4,
  },
  meta: { color: '#71717a', fontSize: 12, marginRight: 4 },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3f3f46',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipOn: { backgroundColor: '#fafafa', borderColor: '#fafafa' },
  chipLabel: { color: '#e4e4e7', fontSize: 12, fontWeight: '600' },
  chipLabelOn: { color: '#0a0a0a' },
  dangerBtn: { alignItems: 'center', paddingVertical: 10 },
  danger: { color: '#fca5a5', fontWeight: '700' },
});
