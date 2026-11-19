import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatBytes, formatTimer } from '../settings';

type Props = {
  elapsedSec: number;
  freeBytes: number | null;
  marks: number[];
  batterySaver: boolean;
  onMark: () => void;
};

export default function RecordingHud({
  elapsedSec,
  freeBytes,
  marks,
  batterySaver,
  onMark,
}: Props) {
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    const timer = setInterval(() => setBlink((value) => !value), 900);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.row}>
        <View style={[styles.dot, blink ? styles.dotOn : styles.dotOff]} />
        <Text style={styles.timer}>{formatTimer(elapsedSec)}</Text>
        {freeBytes != null ? <Text style={styles.meta}>{formatBytes(freeBytes)}</Text> : null}
        {marks.length > 0 ? <Text style={styles.meta}>•{marks.length}</Text> : null}
        {batterySaver ? <Text style={styles.meta}>save</Text> : null}
      </View>
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
