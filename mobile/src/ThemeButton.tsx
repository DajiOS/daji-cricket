import React from 'react';
import { Pressable, View } from 'react-native';
import { C, mode } from './theme';

/** A small switch at the far right of the top of the screen: the knob slides to the right for the dark theme and shows a moon, to the left for light and shows a sun. */
export function ThemeButton({ onPress }: { onPress: () => void }) {
  const dark = mode === 'dark', ink = dark ? '#17130a' : '#ffffff';
  return (
    <Pressable onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: dark }} accessibilityLabel={dark ? 'Switch to light theme' : 'Switch to dark theme'} hitSlop={10}
      style={{ position: 'absolute', top: 48, right: 14, width: 54, height: 30, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, justifyContent: 'center', paddingHorizontal: 3, zIndex: 50 }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', alignSelf: dark ? 'flex-end' : 'flex-start' }}>
        {dark ? (
          <View style={{ width: 12, height: 12 }}>
            <View style={{ position: 'absolute', left: 0, top: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: ink }} />
            <View style={{ position: 'absolute', left: 4, top: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: C.gold }} />
          </View>
        ) : (
          <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ink }} />
            {[0, 45, 90, 135].map((r) => <View key={r} style={{ position: 'absolute', width: 14, height: 1.5, borderRadius: 1, backgroundColor: ink, transform: [{ rotate: `${r}deg` }] }} />)}
          </View>
        )}
      </View>
    </Pressable>
  );
}
