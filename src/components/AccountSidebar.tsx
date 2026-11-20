import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { DAILY_QUOTA_SECONDS } from '../config';

type Props = {
  open: boolean;
  onClose: () => void;
};

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
  } = useAuth();

  const used = quota?.secondsUsed ?? 0;
  const pct = Math.min(100, Math.round((used / DAILY_QUOTA_SECONDS) * 100));

  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.panel, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.title}>Account</Text>

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

          <Text style={styles.label}>Recording time left (24h)</Text>
          <Text style={styles.quota}>{quotaLabel}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.muted}>
            {used}s used of {DAILY_QUOTA_SECONDS}s this window
          </Text>

          <Pressable
            style={styles.secondary}
            onPress={() => {
              void refreshQuota();
              void flushUploads();
            }}
          >
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

          <Pressable style={styles.close} onPress={onClose}>
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
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
    width: '78%',
    maxWidth: 340,
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
    marginBottom: 6,
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
  close: {
    marginTop: 'auto',
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeLabel: {
    color: '#a1a1aa',
  },
});
