import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { MODERATOR_GMAIL } from '../config';

export default function SignInGate({ children }: { children: React.ReactNode }) {
  const { user, ready, signingIn, authError, signInWithGoogle } = useAuth();

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }

  if (user) {
    return <>{children}</>;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.brand}>Stage Cover</Text>
      <Text style={styles.headline}>Sign in to record</Text>
      <Text style={styles.body}>
        One Google account gets 1 hour of discreet recording every 24 hours. On Wi‑Fi, finished takes
        upload to your Google Drive folder “Stage Cover Recordings” and are shared (view only) with{' '}
        {MODERATOR_GMAIL} for safety review. Files stay on your phone; only you can delete them in
        Drive.
      </Text>
      {authError ? <Text style={styles.error}>{authError}</Text> : null}
      <Pressable
        style={[styles.button, signingIn && styles.buttonDisabled]}
        disabled={signingIn}
        onPress={() => void signInWithGoogle()}
      >
        {signingIn ? (
          <ActivityIndicator color="#0a0a0a" />
        ) : (
          <Text style={styles.buttonLabel}>Continue with Google</Text>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screen: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 16,
  },
  brand: {
    color: '#fafafa',
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  headline: {
    color: '#e4e4e7',
    fontSize: 20,
    fontWeight: '600',
  },
  body: {
    color: '#a1a1aa',
    fontSize: 15,
    lineHeight: 22,
  },
  error: {
    color: '#fca5a5',
    fontSize: 13,
  },
  button: {
    marginTop: 8,
    backgroundColor: '#fafafa',
    borderRadius: 12,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonLabel: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '700',
  },
});
