import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatBytes, formatTimer } from '../settings';

type Props = {
  elapsedSec: number;
  freeBytes: number | null;
  marks: number[];
  batterySaver: boolean;
  hudVisible: boolean;
  onToggleHud: () => void;
  onMark: () => void;
};

export default function RecordingHud({
  elapsedSec,
  freeBytes,
  marks,
  batterySaver,
  hudVisible,
  onToggleHud,
  onMark,
}: Props) {
  const [blink, setBlink] = useState(true);
  const tapsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!hudVisible) {
      return;
    }
    const timer = setInterval(() => setBlink((value) => !value), 900);
    return () => clearInterval(timer);
  }, [hudVisible]);

  function handleCornerTap() {
    const now = Date.now();
    tapsRef.current = [...tapsRef.current.filter((t) => now - t < 900), now];
    if (tapsRef.current.length >= 3) {
      tapsRef.current = [];
      onToggleHud();
    }
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {hudVisible ? (
        <View style={styles.row}>
          <View style={[styles.dot, blink ? styles.dotOn : styles.dotOff]} />
          <Text style={styles.timer}>{formatTimer(elapsedSec)}</Text>
          {freeBytes != null ? <Text style={styles.meta}>{formatBytes(freeBytes)}</Text> : null}
          {marks.length > 0 ? <Text style={styles.meta}>•{marks.length}</Text> : null}
          {batterySaver ? <Text style={styles.meta}>save</Text> : null}
        </View>
      ) : (
        <View style={styles.rowHidden} />
      )}
      {/* Triple-tap this corner to show/hide HUD */}
      <Pressable style={styles.hudHit} onPress={handleCornerTap} hitSlop={8} />
      <Pressable style={styles.markHit} onPress={onMark} hitSlop={12}>
        <View style={styles.markPixel} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    zIndex: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rowHidden: {
    width: 8,
    height: 8,
  },
  hudHit: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 56,
    height: 56,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  dotOn: {
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  dotOff: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  timer: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  meta: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 10,
  },
  markHit: {
    width: 28,
    height: 28,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  markPixel: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});
