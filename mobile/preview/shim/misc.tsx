import React from 'react';
export const StatusBar = () => null;
const Constants = { expoConfig: { extra: {} } };
export default Constants;
export const WebView = ({ source }: any) => <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9a9a8f', fontSize: 13, textAlign: 'center', padding: 24, border: '1px dashed #2a302b', margin: 12, borderRadius: 10 }}>Web view: {source?.uri ? 'shows the website desk here' : 'the Razorpay checkout opens here'}</div>;
