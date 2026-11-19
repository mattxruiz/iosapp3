import { SafeAreaProvider } from 'react-native-safe-area-context';
import StageCover from './src/StageCover';

export default function App() {
  return (
    <SafeAreaProvider>
      <StageCover />
    </SafeAreaProvider>
  );
}
