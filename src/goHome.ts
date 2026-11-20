import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

/**
 * Leave BlacRec for the phone home screen.
 * Android: HOME intent (process stays alive → recording can continue).
 * iOS: do NOT call UIApplication.suspend — that freezes the process and kills the take.
 * User swipes home; AppState + UIBackgroundModes audio keep recording when usePhoneRegularly is on.
 */
export async function goToPhoneHome(): Promise<void> {
  if (Platform.OS === 'android') {
    await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
      category: 'android.intent.category.HOME',
    });
  }
}
