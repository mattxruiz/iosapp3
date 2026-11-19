import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CoverPreset } from '../settings';

type Props = {
  kind: Extract<CoverPreset, 'messages' | 'notes' | 'spotify' | 'calculator' | 'clock'>;
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export default function CoverSkins({ kind }: Props) {
  const now = useClock();
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  if (kind === 'clock') {
    return (
      <View style={styles.clockRoot}>
        <Text style={styles.clockTime}>{time}</Text>
        <Text style={styles.clockDate}>{date}</Text>
      </View>
    );
  }

  if (kind === 'messages') {
    return (
      <View style={styles.messagesRoot}>
        <View style={styles.messagesHeader}>
          <Text style={styles.messagesEdit}>Edit</Text>
          <Text style={styles.messagesTitle}>Messages</Text>
          <Text style={styles.messagesCompose}>＋</Text>
        </View>
        {[
          ['Mom', 'Text me when you get there'],
          ['Dad', 'Parking is on the east side'],
          ['School', 'Doors open at 6:30'],
        ].map(([name, preview]) => (
          <View key={name} style={styles.messageRow}>
            <View style={styles.avatar} />
            <View style={styles.messageText}>
              <Text style={styles.messageName}>{name}</Text>
              <Text style={styles.messagePreview} numberOfLines={1}>
                {preview}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (kind === 'notes') {
    return (
      <View style={styles.notesRoot}>
        <Text style={styles.notesTitle}>Notes</Text>
        <Text style={styles.notesItem}>Shopping</Text>
        <Text style={styles.notesItem}>Weekend plans</Text>
        <Text style={styles.notesItem}>Ideas</Text>
        <View style={styles.noteCard}>
          <Text style={styles.noteCardTitle}>Today</Text>
          <Text style={styles.noteCardBody}> </Text>
        </View>
      </View>
    );
  }

  if (kind === 'spotify') {
    return (
      <View style={styles.spotifyRoot}>
        <View style={styles.spotifyArt} />
        <Text style={styles.spotifyTrack}>Liked Songs</Text>
        <Text style={styles.spotifyArtist}>Your Library</Text>
        <View style={styles.spotifyBar}>
          <View style={styles.spotifyFill} />
        </View>
        <View style={styles.spotifyControls}>
          <Text style={styles.spotifyBtn}>⏮</Text>
          <Text style={styles.spotifyPlay}>▶</Text>
          <Text style={styles.spotifyBtn}>⏭</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.calcRoot}>
      <Text style={styles.calcDisplay}>0</Text>
      <View style={styles.calcGrid}>
        {['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='].map(
          (key) => (
            <View
              key={key}
              style={[
                styles.calcKey,
                key === '0' && styles.calcKeyWide,
                ['÷', '×', '−', '+', '='].includes(key) && styles.calcKeyOp,
              ]}
            >
              <Text style={styles.calcKeyLabel}>{key}</Text>
            </View>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clockRoot: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockTime: {
    color: '#fff',
    fontSize: 72,
    fontWeight: '200',
  },
  clockDate: {
    color: '#a1a1aa',
    fontSize: 18,
    marginTop: 8,
  },
  messagesRoot: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
    paddingTop: 58,
  },
  messagesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  messagesEdit: { color: '#0a84ff', fontSize: 17 },
  messagesTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  messagesCompose: { color: '#0a84ff', fontSize: 22 },
  messageRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#3a3a3c',
  },
  messageText: { flex: 1, justifyContent: 'center', gap: 3 },
  messageName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  messagePreview: { color: '#8e8e93', fontSize: 14 },
  notesRoot: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#1c1c1e',
    paddingTop: 64,
    paddingHorizontal: 18,
  },
  notesTitle: { color: '#fff', fontSize: 34, fontWeight: '700', marginBottom: 18 },
  notesItem: { color: '#ffd60a', fontSize: 17, marginBottom: 14 },
  noteCard: {
    marginTop: 10,
    backgroundColor: '#2c2c2e',
    borderRadius: 14,
    padding: 16,
    minHeight: 160,
  },
  noteCardTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  noteCardBody: { color: '#fff', marginTop: 10 },
  spotifyRoot: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#121212',
    alignItems: 'center',
    paddingTop: 90,
  },
  spotifyArt: {
    width: 240,
    height: 240,
    borderRadius: 8,
    backgroundColor: '#333',
    marginBottom: 28,
  },
  spotifyTrack: { color: '#fff', fontSize: 22, fontWeight: '700' },
  spotifyArtist: { color: '#b3b3b3', fontSize: 15, marginTop: 6 },
  spotifyBar: {
    width: '80%',
    height: 3,
    backgroundColor: '#404040',
    borderRadius: 2,
    marginTop: 28,
    overflow: 'hidden',
  },
  spotifyFill: { width: '28%', height: '100%', backgroundColor: '#fff' },
  spotifyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 36,
    marginTop: 28,
  },
  spotifyBtn: { color: '#fff', fontSize: 28 },
  spotifyPlay: { color: '#fff', fontSize: 42 },
  calcRoot: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
    justifyContent: 'flex-end',
    paddingBottom: 28,
    paddingHorizontal: 10,
  },
  calcDisplay: {
    color: '#fff',
    fontSize: 72,
    fontWeight: '200',
    textAlign: 'right',
    paddingHorizontal: 18,
    marginBottom: 18,
  },
  calcGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  calcKey: {
    width: '23%',
    aspectRatio: 1,
    borderRadius: 40,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calcKeyWide: { width: '48%' },
  calcKeyOp: { backgroundColor: '#ff9f0a' },
  calcKeyLabel: { color: '#fff', fontSize: 28, fontWeight: '400' },
});
