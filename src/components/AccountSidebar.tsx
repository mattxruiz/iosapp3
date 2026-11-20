import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import {
  DAILY_QUOTA_SECONDS,
  SUPPORT_CONTACT_LINK,
  UNLIMITED_PRICE_LABEL,
} from '../config';

type Props = {
  open: boolean;
  onClose: () => void;
};

const PANEL_WIDTH = Math.min(340, Dimensions.get('window').width * 0.78);

function MailIcon({ color = '#e4e4e7' }: { color?: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Z"
        stroke={color}
        strokeWidth={1.6}
      />
      <Path
        d="m5 7 7 5.5L19 7"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function AccountSidebar({ open, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const {
    user,
    quota,
    quotaLabel,
    signingIn,
    signInWithGoogle,
    signOut,
    flushUploads,
    refreshQuota,
    unlockUnlimited,
  } = useAuth();

  const [refreshing, setRefreshing] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);

  const translateX = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      translateX.setValue(0);
    }
  }, [open, translateX]);

  useEffect(() => {
    if (!refreshing) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_, g) => {
          if (g.dx < 0) {
            translateX.setValue(g.dx);
          }
        },
        onPanResponderRelease: (_, g) => {
          const shouldClose = g.dx < -72 || g.vx < -0.55;
          if (shouldClose) {
            Animated.timing(translateX, {
              toValue: -PANEL_WIDTH,
              duration: 180,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start(() => {
              translateX.setValue(0);
              onClose();
            });
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 0,
              speed: 18,
            }).start();
          }
        },
      }),
    [onClose, translateX],
  );

  const used = quota?.secondsUsed ?? 0;
  const unlimited = Boolean(quota?.unlimited);
  const pct = unlimited
    ? 0
    : Math.min(100, Math.round((used / DAILY_QUOTA_SECONDS) * 100));

  async function onRefresh() {
    setRefreshing(true);
    const started = Date.now();
    try {
      await Promise.race([
        Promise.all([refreshQuota(), flushUploads()]),
        sleep(2000),
      ]);
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed < 200) {
        await sleep(200 - elapsed);
      }
      setRefreshing(false);
    }
  }

  async function copySupportLink() {
    await Clipboard.setStringAsync(SUPPORT_CONTACT_LINK);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  async function confirmUnlock() {
    if (!user || buying) {
      return;
    }
    setBuying(true);
    try {
      // App Store IAP (UNLIMITED_PRODUCT_ID) plugs in here — Firestore flag until then.
      await unlockUnlimited();
      setBuyOpen(false);
    } finally {
      setBuying(false);
    }
  }

  const spinRotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View
          style={[
            styles.panel,
            {
              width: PANEL_WIDTH,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 16,
              transform: [{ translateX }],
            },
          ]}
          {...pan.panHandlers}
        >
          <Text style={styles.title}>Account</Text>
          <Text style={styles.dragHint}>Swipe left to close</Text>

          {user ? (
            <View style={styles.card}>
              {user.photoURL ? (
                <Image source={{ uri: user.photoURL }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarLetter}>
                    {(user.displayName ?? user.email ?? '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.meta}>
                <Text style={styles.name} numberOfLines={1}>
                  {user.displayName ?? 'Signed in'}
                </Text>
                <Text style={styles.email} numberOfLines={1}>
                  {user.email}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.muted}>Not signed in</Text>
          )}

          <Text style={styles.label}>Recording time (24h)</Text>
          <Text style={styles.quota}>{quotaLabel}</Text>
          {!unlimited ? (
            <>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.muted}>
                {Math.floor(used / 60)}m used of {DAILY_QUOTA_SECONDS / 60}m this window
              </Text>
            </>
          ) : (
            <Text style={styles.muted}>Lifetime unlimited — no daily cap</Text>
          )}

          {!unlimited && user ? (
            <Pressable style={styles.unlock} onPress={() => setBuyOpen(true)}>
              <Text style={styles.unlockLabel}>
                Unlock unlimited · {UNLIMITED_PRICE_LABEL}
              </Text>
              <Text style={styles.unlockSub}>One-time · forever</Text>
            </Pressable>
          ) : null}

          <Pressable style={styles.secondary} onPress={() => void onRefresh()}>
            <Text style={styles.secondaryLabel}>Refresh</Text>
          </Pressable>

          {user ? (
            <Pressable
              style={styles.danger}
              onPress={() => {
                void signOut().then(onClose);
              }}
            >
              <Text style={styles.dangerLabel}>Sign out</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.primary}
              disabled={signingIn}
              onPress={() => void signInWithGoogle()}
            >
              <Text style={styles.primaryLabel}>
                {signingIn ? 'Signing in…' : 'Sign in with Google'}
              </Text>
            </Pressable>
          )}

          <Pressable
            style={styles.support}
            onPress={() => {
              setCopied(false);
              setSupportOpen(true);
            }}
          >
            <MailIcon />
            <Text style={styles.supportLabel}>Contact support</Text>
          </Pressable>
        </Animated.View>

        <Pressable style={styles.backdrop} onPress={onClose} />
      </View>

      {refreshing ? (
        <View style={styles.refreshOverlay} pointerEvents="none">
          <View style={styles.refreshCard}>
            <Animated.View style={{ transform: [{ rotate: spinRotate }] }}>
              <View style={styles.spinnerRing} />
            </Animated.View>
            <Text style={styles.refreshText}>Refreshing</Text>
          </View>
        </View>
      ) : null}

      {supportOpen ? (
        <Pressable style={styles.popupRoot} onPress={() => setSupportOpen(false)}>
          <Pressable style={styles.popupCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.popupTitle}>Contact support</Text>
            <Text style={styles.popupBody}>Copy the link below, then reach out anytime.</Text>
            <Pressable style={styles.linkChip} onPress={() => void copySupportLink()}>
              <Text style={styles.linkText} numberOfLines={2}>
                {SUPPORT_CONTACT_LINK}
              </Text>
              <Text style={styles.copyHint}>{copied ? 'Copied' : 'Tap to copy'}</Text>
            </Pressable>
            <Text style={styles.popupDismiss}>Tap anywhere to close</Text>
          </Pressable>
        </Pressable>
      ) : null}

      {buyOpen ? (
        <Pressable style={styles.popupRoot} onPress={() => !buying && setBuyOpen(false)}>
          <Pressable style={styles.popupCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.popupTitle}>Unlimited recording</Text>
            <Text style={styles.popupBody}>
              One-time {UNLIMITED_PRICE_LABEL}. Removes the 30-minute / 24h cap for life on this
              account.
            </Text>
            <Pressable
              style={[styles.primary, buying && { opacity: 0.6 }]}
              disabled={buying}
              onPress={() => void confirmUnlock()}
            >
              {buying ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <Text style={styles.primaryLabel}>Unlock · {UNLIMITED_PRICE_LABEL}</Text>
              )}
            </Pressable>
            <Text style={styles.popupDismiss}>Tap outside to cancel</Text>
          </Pressable>
        </Pressable>
      ) : null}
    </Modal>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backdrop: {
    flex: 1,
  },
  panel: {
    backgroundColor: '#121214',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#27272a',
    paddingHorizontal: 18,
    gap: 10,
  },
  title: {
    color: '#fafafa',
    fontSize: 22,
    fontWeight: '700',
  },
  dragHint: {
    color: '#52525b',
    fontSize: 11,
    marginTop: -4,
    marginBottom: 4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarFallback: {
    backgroundColor: '#3f3f46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '700',
  },
  meta: {
    flex: 1,
  },
  name: {
    color: '#fafafa',
    fontSize: 16,
    fontWeight: '600',
  },
  email: {
    color: '#a1a1aa',
    fontSize: 13,
  },
  label: {
    color: '#a1a1aa',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 8,
  },
  quota: {
    color: '#fafafa',
    fontSize: 28,
    fontWeight: '700',
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#27272a',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#e4e4e7',
  },
  muted: {
    color: '#71717a',
    fontSize: 13,
  },
  unlock: {
    marginTop: 4,
    backgroundColor: '#fafafa',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  unlockLabel: {
    color: '#0a0a0a',
    fontWeight: '700',
    fontSize: 15,
  },
  unlockSub: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 2,
  },
  primary: {
    marginTop: 12,
    backgroundColor: '#fafafa',
    borderRadius: 10,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    color: '#0a0a0a',
    fontWeight: '700',
  },
  secondary: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3f3f46',
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    color: '#e4e4e7',
    fontWeight: '600',
  },
  danger: {
    marginTop: 8,
    borderRadius: 10,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3f1d1d',
  },
  dangerLabel: {
    color: '#fecaca',
    fontWeight: '700',
  },
  support: {
    marginTop: 'auto',
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  supportLabel: {
    color: '#e4e4e7',
    fontWeight: '600',
    fontSize: 14,
  },
  refreshOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 20,
  },
  refreshCard: {
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(24,24,27,0.92)',
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  spinnerRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: 'rgba(250,250,250,0.18)',
    borderTopColor: '#fafafa',
  },
  refreshText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  popupRoot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 30,
    paddingHorizontal: 28,
  },
  popupCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 22,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  popupTitle: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '700',
  },
  popupBody: {
    color: '#a1a1aa',
    fontSize: 14,
    lineHeight: 20,
  },
  linkChip: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  linkText: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '500',
  },
  copyHint: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '600',
  },
  popupDismiss: {
    color: '#52525b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
});
