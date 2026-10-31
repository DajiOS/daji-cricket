import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { C, mode, tint } from './theme';
import { Icon, type IconName } from './ui';

const TAB_ICON: Record<string, IconName> = { home: 'home', book: 'calendar', me: 'receipt', live: 'radio', ask: 'sparkles', profile: 'person-circle', bookings: 'calendar', tasks: 'checkbox', more: 'grid', signin: 'log-in' };
/** The bar of tabs along the bottom: an icon over each name; the open tab is filled green. */
export function TabBar({ tabs, on, onPick, bottom }: { tabs: [string, string][]; on: string; onPick: (id: string) => void; bottom: number }) {
  return (
    <View style={{ backgroundColor: C.bg, paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(10, bottom) }}>
    <View style={{ flexDirection: 'row', backgroundColor: C.bar, borderRadius: 30, paddingHorizontal: 6, paddingVertical: 8, shadowColor: '#000000', shadowOpacity: mode === 'light' ? 0.1 : 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
      {tabs.map(([id, name]) => {
        const sel = on === id, icon = TAB_ICON[id] ?? 'ellipse';
        return (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: sel }} accessibilityLabel={name} onPress={() => onPick(id)} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <View style={{ paddingVertical: 5, paddingHorizontal: 16, borderRadius: 999, backgroundColor: sel ? tint(C.onBg, 0.16) : 'transparent' }}>
              <Icon name={(sel ? icon : `${icon}-outline`) as IconName} size={22} color={sel ? C.onBg : C.headMuted} />
            </View>
            <Text numberOfLines={1} style={{ color: sel ? C.onBg : C.headMuted, fontSize: 11, fontWeight: sel ? '800' : '600' }}>{name}</Text>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}
