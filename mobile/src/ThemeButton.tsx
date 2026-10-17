import React from 'react';
import { Pressable, View } from 'react-native';
import { C, mode } from './theme';

/** Sun or moon at the far right of the top of the screen. A moon in the light theme (tap for dark), a sun in the dark theme (tap for light). */
export function ThemeButton({ onPress }: { onPress: () => void }) {
  const dark = mode === 'dark', col = C.text;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={dark ? 'Switch to light theme' : 'Switch to dark theme'} hitSlop={8}
      style={{ position: 'absolute', top: 46, right: 14, width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      {dark ? (
        <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: col }} />
          {[0, 45, 90, 135].map((r) => <View key={r} style={{ position: 'absolute', width: 20, height: 2, borderRadius: 1, backgroundColor: col, transform: [{ rotate: `${r}deg` }] }} />)}
          <View style={{ position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: C.panel }} />
          <View style={{ position: 'absolute', width: 9, height: 9, borderRadius: 4.5, backgroundColor: col }} />
        </View>
      ) : (
        <View style={{ width: 20, height: 20 }}>
          <View style={{ position: 'absolute', left: 1, top: 1, width: 18, height: 18, borderRadius: 9, backgroundColor: col }} />
          <View style={{ position: 'absolute', left: 7, top: -1, width: 16, height: 16, borderRadius: 8, backgroundColor: C.panel }} />
        </View>
      )}
    </Pressable>
  );
}
