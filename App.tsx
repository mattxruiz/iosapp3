import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import SignInGate from './src/components/SignInGate';
import BlacRec from './src/BlacRec';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SignInGate>
          <BlacRec />
        </SignInGate>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
