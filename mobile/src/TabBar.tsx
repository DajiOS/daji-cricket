import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { C, mode } from './theme';
import { Icon, type IconName } from './ui';

const TAB_ICON: Record<string, IconName> = { home: 'home', book: 'calendar', me: 'receipt', live: 'radio', ask: 'sparkles', profile: 'person-circle', bookings: 'calendar', tasks: 'checkbox', more: 'grid', signin: 'log-in' };
/** The bar of tabs along the bottom: an icon over each name; the open tab is filled green. */
export function TabBar({ tabs, on, onPick, bottom }: { tabs: [string, string][]; on: string; onPick: (id: string) => void; bottom: number }) {
  return (
    <View style={{ backgroundColor: C.bg, paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(10, bottom) }}>
    <View style={{ flexDirection: 'row', backgroundColor: C.bar, borderRadius: 36, paddingHorizontal: 6, paddingVertical: 8, shadowColor: '#000000', shadowOpacity: mode === 'light' ? 0.1 : 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
      {tabs.map(([id, name]) => {
        const sel = on === id, icon = TAB_ICON[id] ?? 'ellipse';
        return (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: sel }} accessibilityLabel={name} onPress={() => onPick(id)} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? C.strong : 'transparent' }}>
              <Icon name={(sel ? icon : `${icon}-outline`) as IconName} size={22} color={sel ? C.onStrong : C.headMuted} />
            </View>
            <Text numberOfLines={1} style={{ color: sel ? C.text : C.headMuted, fontSize: 10.5, fontWeight: sel ? '600' : '500' }}>{name}</Text>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}
