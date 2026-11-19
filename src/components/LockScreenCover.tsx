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
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) {
    hours = 12;
  }
  return `${hours}:${minutes}`;
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, {
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
        onMoveShouldSetPanResponder: (_event, gesture) =>
          surface === 'lock' && gesture.dy < -12 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (surface === 'lock' && gesture.dy < -60) {
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
    const next = `${digits}${key}`.slice(0, pin.length);
    setDigits(next);
    if (next.length === pin.length) {
      if (next === pin) {
        unlocking.current = true;
        onUnlock();
      } else {
        setShake(true);
        setTimeout(() => {
          setDigits('');
          setShake(false);
        }, 350);
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
          <View style={styles.fakeHome}>
            {wallpaperUri ? (
              <Image source={{ uri: wallpaperUri }} style={styles.fillImage} resizeMode="cover" />
            ) : (
              <View style={styles.gradient} />
            )}
            <View style={styles.homeGrid}>
              {Array.from({ length: 12 }).map((_, index) => (
                <View key={index} style={styles.appIcon} />
              ))}
            </View>
            <View style={styles.dock}>
              {Array.from({ length: 4 }).map((_, index) => (
                <View key={index} style={styles.dockIcon} />
              ))}
            </View>
          </View>
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
      <View style={styles.dim} />

      {surface === 'lock' ? (
        <View style={styles.lockContent} pointerEvents="box-none">
          <Text style={styles.time}>{formatTime(now)}</Text>
          <Text style={styles.date}>{formatDate(now)}</Text>
          <View style={styles.lockFooter}>
            <Text style={styles.swipeHint}>Swipe up to unlock</Text>
            <View style={styles.homeIndicator} />
          </View>
        </View>
      ) : (
        <View style={styles.passcodeContent}>
          <Pressable onPress={onBackToLock} style={styles.backHit}>
            <Text style={styles.backLabel}>Cancel</Text>
          </Pressable>
          <Text style={styles.passcodeTitle}>Enter Passcode</Text>
          <View style={[styles.dots, shake && styles.dotsShake]}>
            {Array.from({ length: pin.length }).map((_, index) => (
              <View
                key={index}
                style={[styles.dot, index < digits.length ? styles.dotFilled : null]}
              />
            ))}
          </View>
          <View style={styles.pad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key) => {
              if (!key) {
                return <View key="blank" style={styles.key} />;
              }
              return (
                <Pressable key={key} style={styles.key} onPress={() => pressKey(key)}>
                  <Text style={styles.keyLabel}>{key === 'del' ? '⌫' : key}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const { width } = Dimensions.get('window');
const keySize = Math.min(78, (width - 72) / 3);

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
    backgroundColor: '#1c2333',
  },
  dim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  lockContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 84,
  },
  time: {
    color: '#fff',
    fontSize: 84,
    fontWeight: '300',
    letterSpacing: 1,
  },
  date: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '500',
    marginTop: 2,
  },
  lockFooter: {
    position: 'absolute',
    bottom: 28,
    alignItems: 'center',
    gap: 14,
  },
  swipeHint: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontWeight: '500',
  },
  homeIndicator: {
    width: 128,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  passcodeContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 72,
  },
  backHit: {
    position: 'absolute',
    top: 54,
    left: 18,
    padding: 8,
  },
  backLabel: {
    color: '#fff',
    fontSize: 17,
  },
  passcodeTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
    marginBottom: 28,
  },
  dots: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 36,
  },
  dotsShake: {
    opacity: 0.45,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  dotFilled: {
    backgroundColor: '#fff',
  },
  pad: {
    width: keySize * 3 + 36,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
  },
  key: {
    width: keySize,
    height: keySize,
    borderRadius: keySize / 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '400',
  },
  fakeHome: {
    flex: 1,
  },
  homeGrid: {
    position: 'absolute',
    top: 72,
    left: 24,
    right: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 22,
  },
  appIcon: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  dock: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 22,
    height: 88,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.22)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  dockIcon: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
