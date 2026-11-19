import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import SignInGate from './src/components/SignInGate';
import StageCover from './src/StageCover';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SignInGate>
          <StageCover />
        </SignInGate>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
