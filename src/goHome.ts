import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

/** Leave BlacRec for the phone home screen (Android). iOS: soft-suspend when available. */
export async function goToPhoneHome(): Promise<void> {
  if (Platform.OS === 'android') {
    await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
      category: 'android.intent.category.HOME',
    });
    return;
  }

  // Sideload / custom builds: optional native suspend (private API). Safe no-op if missing.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require('expo-modules-core') as {
      requireNativeModule: (name: string) => { goHome?: () => void };
    };
    const mod = requireNativeModule('BlacRecHome');
    mod.goHome?.();
  } catch {
    // User can still swipe home; recording continues when usePhoneRegularly is on.
  }
}
