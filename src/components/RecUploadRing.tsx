import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DriveRingStatus } from '../driveUpload';

type Props = {
  status: DriveRingStatus;
  progress: number;
  disabled?: boolean;
  label: string;
  onPress: () => void;
};

/** Soft edge glow only — no spin. Uploading stays faint; done states vanish quickly. */
export default function RecUploadRing({ status, disabled, label, onPress }: Props) {
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    glow.stopAnimation();

    if (status === 'idle') {
      glow.setValue(0);
      return;
    }

    if (status === 'uploading') {
      glow.setValue(0.22);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, {
            toValue: 0.38,
            duration: 1100,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(glow, {
            toValue: 0.16,
            duration: 1100,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }

    // success / error — short tint, then gone
    glow.setValue(0.45);
    const fade = Animated.timing(glow, {
      toValue: 0,
      duration: 520,
      delay: 280,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [status, glow]);

  const borderColor =
    status === 'uploading'
      ? 'rgba(250,250,250,0.35)'
      : status === 'success'
        ? 'rgba(74,222,128,0.4)'
        : status === 'error'
          ? 'rgba(248,113,113,0.4)'
          : 'transparent';

  return (
    <Pressable
      style={[styles.hit, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.outline, { borderColor, opacity: glow }]}
      />
      <View style={styles.chip}>
        <View style={styles.dot} />
        <Text style={styles.label}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  disabled: { opacity: 0.45 },
  outline: {
    ...StyleSheet.absoluteFill,
    borderRadius: 16,
    borderWidth: 1,
    margin: -1.5,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(28,28,30,0.85)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#a1a1aa' },
  label: { color: '#e4e4e7', fontSize: 13, fontWeight: '600' },
});
