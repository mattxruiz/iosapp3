import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  pin: string;
  onUnlock: () => void;
};

export default function AppLockGate({ pin, onUnlock }: Props) {
  const [digits, setDigits] = useState('');
  const [shake, setShake] = useState(false);

  function press(key: string) {
    if (key === 'del') {
      setDigits((current) => current.slice(0, -1));
      return;
    }
    const next = `${digits}${key}`.slice(0, pin.length);
    setDigits(next);
    if (next.length === pin.length) {
      if (next === pin) {
        onUnlock();
      } else {
        setShake(true);
        setTimeout(() => {
          setDigits('');
          setShake(false);
        }, 280);
      }
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Enter Passcode</Text>
      <View style={[styles.dots, shake && styles.shake]}>
        {Array.from({ length: pin.length || 4 }).map((_, index) => (
          <View key={index} style={[styles.dot, index < digits.length && styles.dotOn]} />
        ))}
      </View>
      <View style={styles.pad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key) => {
          if (!key) {
            return <View key="blank" style={styles.key} />;
          }
          return (
            <Pressable key={key} style={styles.key} onPress={() => press(key)}>
              <Text style={styles.keyLabel}>{key === 'del' ? '⌫' : key}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0b0b0c',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    paddingBottom: 40,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 28,
  },
  dots: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 36,
  },
  shake: {
    opacity: 0.4,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  dotOn: {
    backgroundColor: '#fff',
  },
  pad: {
    width: 270,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
  },
  key: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#1f1f22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: {
    color: '#fff',
    fontSize: 28,
  },
});
