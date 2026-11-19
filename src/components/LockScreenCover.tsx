import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type LockSurface = 'off' | 'lock' | 'passcode' | 'home';

type Props = {
  surface: LockSurface;
  wallpaperUri: string | null;
  homeShotUri: string | null;
  pin: string;
  onSwipeToPasscode: () => void;
  onUnlock: () => void;
  onBackToLock: () => void;
};

function formatTime(date: Date) {
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  hours = hours % 12;
  if (hours === 0) {
    hours = 12;
  }
  return `${hours}:${minutes}`;
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function LockScreenCover({
  surface,
  wallpaperUri,
  homeShotUri,
  pin,
  onSwipeToPasscode,
  onUnlock,
  onBackToLock,
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const [digits, setDigits] = useState('');
  const [shake, setShake] = useState(false);
  const unlocking = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (surface !== 'passcode') {
      setDigits('');
      setShake(false);
      unlocking.current = false;
    }
  }, [surface]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => {
          if (surface !== 'lock') {
            return false;
          }
          const sideways = Math.abs(gesture.dx) > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
          const upward = gesture.dy < -14 && Math.abs(gesture.dy) > Math.abs(gesture.dx);
          return sideways || upward;
        },
        onPanResponderRelease: (_event, gesture) => {
          if (surface !== 'lock') {
            return;
          }
          const sideways = Math.abs(gesture.dx) > 56;
          const upward = gesture.dy < -56;
          if (sideways || upward) {
            onSwipeToPasscode();
          }
        },
      }),
    [onSwipeToPasscode, surface],
  );

  function pressKey(key: string) {
    if (unlocking.current || surface !== 'passcode') {
      return;
    }
    if (key === 'del') {
      setDigits((current) => current.slice(0, -1));
      return;
    }
    const next = `${digits}${key}`.slice(0, pin.length || 6);
    setDigits(next);
    if (pin.length > 0 && next.length === pin.length) {
      if (next === pin) {
        unlocking.current = true;
        onUnlock();
      } else {
        setShake(true);
        setTimeout(() => {
          setDigits('');
          setShake(false);
        }, 320);
      }
    }
  }

  if (surface === 'off') {
    return <View style={styles.off} pointerEvents="none" />;
  }

  if (surface === 'home') {
    return (
      <View style={styles.fill} pointerEvents="none">
        {homeShotUri ? (
          <Image source={{ uri: homeShotUri }} style={styles.fillImage} resizeMode="cover" />
        ) : (
          <View style={styles.gradient} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.fill} {...(surface === 'lock' ? pan.panHandlers : {})}>
      {wallpaperUri ? (
        <Image source={{ uri: wallpaperUri }} style={styles.fillImage} resizeMode="cover" />
      ) : (
        <View style={styles.gradient} />
      )}

      {surface === 'lock' ? (
        <>
          <View style={styles.lockTop}>
            <Text style={styles.time}>{formatTime(now)}</Text>
            <Text style={styles.date}>{formatDate(now)}</Text>
          </View>
          <View style={styles.lockBottom} pointerEvents="none">
            <View style={styles.flashlight} />
            <View style={styles.cameraBtn} />
          </View>
          <View style={styles.homeIndicator} pointerEvents="none" />
        </>
      ) : (
        <View style={styles.passcodeShell}>
          <View style={styles.passcodeDim} />
          <Text style={styles.passcodeTitle}>Enter Passcode</Text>
          <View style={[styles.dots, shake && styles.dotsShake]}>
            {Array.from({ length: Math.max(pin.length, 6) }).map((_, index) => (
              <View
                key={index}
                style={[styles.dot, index < digits.length ? styles.dotFilled : null]}
              />
            ))}
          </View>
          <View style={styles.pad}>
            {[
              ['1', ''],
              ['2', 'A B C'],
              ['3', 'D E F'],
              ['4', 'G H I'],
              ['5', 'J K L'],
              ['6', 'M N O'],
              ['7', 'P Q R S'],
              ['8', 'T U V'],
              ['9', 'W X Y Z'],
              ['', ''],
              ['0', ''],
              ['del', ''],
            ].map(([key, letters]) => {
              if (!key) {
                return <View key={`blank-${letters}`} style={styles.key} />;
              }
              if (key === 'del') {
                return (
                  <Pressable key="del" style={styles.keyGhost} onPress={() => pressKey('del')}>
                    <Text style={styles.deleteLabel}>Delete</Text>
                  </Pressable>
                );
              }
              return (
                <Pressable key={key} style={styles.key} onPress={() => pressKey(key)}>
                  <Text style={styles.keyLabel}>{key}</Text>
                  {letters ? <Text style={styles.keyLetters}>{letters}</Text> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.passcodeFooter}>
            <Pressable onPress={onBackToLock}>
              <Text style={styles.footerAction}>Cancel</Text>
            </Pressable>
            <Text style={styles.footerSpacer}>Emergency</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const { width } = Dimensions.get('window');
const keySize = Math.min(76, (width - 84) / 3);

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
  },
  off: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
  },
  fillImage: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  gradient: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#152038',
  },
  lockTop: {
    marginTop: 92,
    alignItems: 'center',
  },
  time: {
    color: '#fff',
    fontSize: 88,
    fontWeight: '200',
    letterSpacing: 1,
  },
  date: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '500',
    marginTop: -2,
  },
  lockBottom: {
    position: 'absolute',
    left: 46,
    right: 46,
    bottom: 54,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  flashlight: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  cameraBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  homeIndicator: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 10,
    width: 134,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  passcodeShell: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    paddingTop: 120,
  },
  passcodeDim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20,20,22,0.72)',
  },
  passcodeTitle: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '400',
    marginBottom: 28,
    zIndex: 1,
  },
  dots: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 42,
    zIndex: 1,
  },
  dotsShake: {
    opacity: 0.4,
  },
  dot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  dotFilled: {
    backgroundColor: '#fff',
  },
  pad: {
    width: keySize * 3 + 42,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
    zIndex: 1,
  },
  key: {
    width: keySize,
    height: keySize,
    borderRadius: keySize / 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyGhost: {
    width: keySize,
    height: keySize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '300',
  },
  keyLetters: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginTop: -2,
  },
  deleteLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '400',
  },
  passcodeFooter: {
    position: 'absolute',
    left: 28,
    right: 28,
    bottom: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  footerAction: {
    color: '#fff',
    fontSize: 16,
  },
  footerSpacer: {
    color: '#fff',
    fontSize: 16,
    opacity: 0.9,
  },
});
