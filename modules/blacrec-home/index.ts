import { requireNativeModule } from 'expo-modules-core';

type BlacRecHomeModule = {
  goHome: () => void;
};

export default requireNativeModule<BlacRecHomeModule>('BlacRecHome');
