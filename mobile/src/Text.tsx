import React from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';
import { fontFor, fontsReady } from './fonts';

// Every Text and TextInput in the app comes from here, so the whole app uses the app's typeface at the weight each style asks for.
// A style that names its own fontFamily keeps it. Text inside Text without its own weight inherits its parent's.
const Nested = React.createContext(false);

export const Text = React.forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  const nested = React.useContext(Nested);
  const f = (StyleSheet.flatten(style) ?? {}) as { fontFamily?: string; fontWeight?: string | number };
  const own = !fontsReady || f.fontFamily || (nested && f.fontWeight == null) ? style : [style, { fontFamily: fontFor(f.fontWeight), fontWeight: 'normal' as const }];
  return <Nested.Provider value><RNText ref={ref} {...rest} style={own} /></Nested.Provider>;
});

export const TextInput = React.forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...rest }, ref) {
  const f = (StyleSheet.flatten(style) ?? {}) as { fontFamily?: string; fontWeight?: string | number };
  return <RNTextInput ref={ref} {...rest} style={!fontsReady || f.fontFamily ? style : [style, { fontFamily: fontFor(f.fontWeight), fontWeight: 'normal' as const }]} />;
});
