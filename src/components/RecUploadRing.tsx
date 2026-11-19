import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import type { DriveRingStatus } from '../driveUpload';

const STROKE = 2.5;
const PAD = 3;

type Props = {
  status: DriveRingStatus;
  progress: number;
  disabled?: boolean;
  label: string;
  onPress: () => void;
};

export default function RecUploadRing({ status, progress, disabled, label, onPress }: Props) {
  const spin = useRef(new Animated.Value(0)).current;
  const [size, setSize] = useState({ w: 72, h: 34 });

  useEffect(() => {
    if (status !== 'uploading') {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [status, spin]);

  const color =
    status === 'uploading'
      ? '#eab308'
      : status === 'success'
        ? '#22c55e'
        : status === 'error'
          ? '#ef4444'
          : 'transparent';

  const showRing = status === 'uploading' || status === 'success' || status === 'error';
  const svgW = size.w + PAD * 2;
  const svgH = size.h + PAD * 2;
  const radius = svgH / 2;
  const perimeter = useMemo(() => {
    const straight = Math.max(0, svgW - svgH) * 2;
    const caps = Math.PI * svgH;
    return straight + caps;
  }, [svgW, svgH]);

  const clamped =
    status === 'success' || status === 'error'
      ? 1
      : Math.max(0.06, Math.min(1, progress > 0 ? progress : 0.1));
  const dash = perimeter * clamped;
  const gap = Math.max(0, perimeter - dash);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Pressable
      style={[styles.hit, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      {showRing ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ringAbs,
            {
              width: svgW,
              height: svgH,
              marginLeft: -PAD,
              marginTop: -PAD,
            },
            status === 'uploading' ? { transform: [{ rotate }] } : null,
          ]}
        >
          <Svg width={svgW} height={svgH}>
            <Rect
              x={STROKE / 2}
              y={STROKE / 2}
              width={svgW - STROKE}
              height={svgH - STROKE}
              rx={radius - STROKE / 2}
              ry={radius - STROKE / 2}
              stroke={color}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${dash} ${gap}`}
              strokeLinecap="round"
            />
          </Svg>
        </Animated.View>
      ) : null}
      <View
        style={styles.chip}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0 && (width !== size.w || height !== size.h)) {
            setSize({ w: width, h: height });
          }
        }}
      >
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
  ringAbs: {
    position: 'absolute',
    left: 0,
    top: 0,
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
