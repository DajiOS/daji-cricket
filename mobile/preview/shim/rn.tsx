// A tiny stand-in for react-native that draws with HTML, only for the hosted app preview.
import React from 'react';
type Style = any;
const UNITLESS = new Set(['flex', 'flexGrow', 'flexShrink', 'opacity', 'fontWeight', 'zIndex', 'aspectRatio']);
export function css(style: Style): React.CSSProperties {
  const flat: any = Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean).map((x: any) => (Array.isArray(x) ? Object.assign({}, ...x) : x))) : style || {};
  const out: any = {};
  for (const [k, v0] of Object.entries(flat)) {
    let v: any = v0;
    if (v === undefined || v === null) continue;
    const px = (key: string) => (typeof v === 'number' && !UNITLESS.has(key) ? v + 'px' : v);
    if (k === 'paddingHorizontal') { out.paddingLeft = px(k); out.paddingRight = px(k); }
    else if (k === 'paddingVertical') { out.paddingTop = px(k); out.paddingBottom = px(k); }
    else if (k === 'marginHorizontal') { out.marginLeft = px(k); out.marginRight = px(k); }
    else if (k === 'marginVertical') { out.marginTop = px(k); out.marginBottom = px(k); }
    else if (k === 'flex') out.flex = typeof v === 'number' ? `${v} 1 0%` : v;
    else if (k === 'borderWidth') { out.borderWidth = px(k); out.borderStyle = 'solid'; }
    else if (/^border(Top|Bottom|Left|Right)Width$/.test(k)) { out[k] = px(k); out.borderStyle = 'solid'; }
    else if (k === 'fontWeight') out.fontWeight = String(v);
    else if (k === 'lineHeight' || k === 'letterSpacing') out[k] = typeof v === 'number' ? v + 'px' : v;
    else if (k === 'textAlignVertical' || k === 'elevation' || k === 'shadowOffset' || k === 'shadowOpacity' || k === 'shadowRadius' || k === 'shadowColor' || k === 'tintColor') continue;
    else out[k] = px(k);
  }
  return out;
}
const base: React.CSSProperties = { display: 'flex', flexDirection: 'column', position: 'relative', boxSizing: 'border-box', minWidth: 0, minHeight: 0, flexShrink: 0, alignItems: 'stretch', alignContent: 'flex-start' };
export const StyleSheet = { create: <T,>(x: T): T => x, flatten: (x: any) => css(x), absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } };
export const Platform = { OS: 'ios', select: (o: any) => o.ios ?? o.default };
export const Linking = { openURL: async (u: string) => { console.log('open', u); } };
const InText = React.createContext(false);
export const View = ({ style, children, onLayout, ...p }: any) => <div style={{ ...base, ...css(style) }}>{children}</div>;
export const KeyboardAvoidingView = View;
export const Text = ({ style, children, numberOfLines }: any) => {
  const nested = React.useContext(InText);
  const st: any = { margin: 0, font: 'inherit', ...(nested ? {} : { display: 'block', ...{ boxSizing: 'border-box' } }), whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...css(style) };
  if (numberOfLines === 1) { st.overflow = 'hidden'; st.textOverflow = 'ellipsis'; st.whiteSpace = 'nowrap'; }
  const El: any = nested ? 'span' : 'div';
  return <InText.Provider value><El style={st}>{children}</El></InText.Provider>;
};
export const Pressable = ({ style, children, onPress, disabled }: any) => {
  const [pressed, setPressed] = React.useState(false);
  const st = typeof style === 'function' ? style({ pressed }) : style;
  return <div role="button" tabIndex={0} onClick={() => !disabled && onPress && onPress()} onMouseDown={() => setPressed(true)} onMouseUp={() => setPressed(false)} onMouseLeave={() => setPressed(false)}
    style={{ ...base, cursor: disabled ? 'default' : 'pointer', userSelect: 'none', opacity: pressed && !disabled ? 0.7 : 1, ...css(st) }}>{typeof children === 'function' ? children({ pressed }) : children}</div>;
};
export const ScrollView = ({ style, contentContainerStyle, children, horizontal, refreshControl }: any) => (
  <div style={{ ...base, overflowY: horizontal ? 'hidden' : 'auto', overflowX: horizontal ? 'auto' : 'hidden', flex: '1 1 0%', ...css(style) }}>
    <div style={{ ...base, flexDirection: horizontal ? 'row' : 'column', flexShrink: 0, ...css(contentContainerStyle) }}>{children}</div>
  </div>
);
export const RefreshControl = () => null;
export const ActivityIndicator = ({ color = '#999' }: any) => <div style={{ width: 22, height: 22, border: `2px solid ${color}33`, borderTopColor: color, borderRadius: '50%', animation: 'rnspin .8s linear infinite', alignSelf: 'center' }} />;
export const TextInput = ({ style, value, onChangeText, placeholder, placeholderTextColor, secureTextEntry, keyboardType, multiline, editable, autoCapitalize, maxLength, onSubmitEditing, numberOfLines, autoFocus }: any) => {
  const props: any = { value: value ?? '', placeholder, maxLength, disabled: editable === false, autoFocus, onChange: (e: any) => onChangeText && onChangeText(e.target.value), onKeyDown: (e: any) => { if (e.key === 'Enter' && !multiline && onSubmitEditing) onSubmitEditing(); }, style: { ...base, font: 'inherit', outline: 'none', ['--ph' as any]: placeholderTextColor || '#999', ...css(style) } };
  return multiline ? <textarea rows={numberOfLines || 3} {...props} /> : <input type={secureTextEntry ? 'password' : keyboardType === 'email-address' ? 'email' : keyboardType === 'phone-pad' || keyboardType === 'numeric' ? 'tel' : 'text'} {...props} />;
};
export type TextInputProps = any; export type ViewStyle = any;
export default { View, Text };
export const Image = ({ source, style }: any) => {
  const [src, setSrc] = React.useState<string | undefined>(source && !source.headers ? source.uri : undefined);
  React.useEffect(() => {
    if (!source) return;
    if (!source.headers) { setSrc(source.uri); return; }
    let url = ''; fetch(source.uri, { headers: source.headers }).then((r) => r.blob()).then((b) => { url = URL.createObjectURL(b); setSrc(url); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [source && source.uri]);
  return <img src={src} alt="" style={{ objectFit: 'cover', display: 'block', flexShrink: 0, ...css(style) }} />;
};
