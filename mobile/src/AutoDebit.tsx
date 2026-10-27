import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from './api';
import { CHECKOUT_ORIGINS, isAllowedCheckoutUrl, parseCheckoutMessage } from './checkoutGuard';
import type { Mandate, User } from './types';
import { Btn, Chip, s } from './ui';
import { C, inr } from './theme';

const LIMITS = [200000, 500000, 1000000, 1500000];

/** Auto-debit card for My bookings: approve UPI AutoPay once, and each booking's balance is charged before it starts. Hidden until the owner switches it on. */
export function AutoDebit({ user }: { user: User }) {
  const [m, setM] = useState<Mandate | null>(null);
  const [max, setMax] = useState(500000);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [co, setCo] = useState<{ mandateId: string; html: string } | null>(null);
  const load = useCallback(async () => { try { setM(await api<Mandate>('/api/autodebit')); } catch { setM(null); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (!m || !m.enabled) return null;

  const start = async () => {
    setErr(''); setBusy(true);
    try {
      const st = await api<{ mandateId: string; razorpay: { keyId: string; orderId: string; customerId: string; demo: boolean; amountPaise: number } }>('/api/autodebit/start', { method: 'POST', body: { maxAmountPaise: max } });
      if (st.razorpay.demo) { setM(await api<Mandate>('/api/autodebit/confirm', { method: 'POST', body: { mandateId: st.mandateId } })); return; }
      const cfg = JSON.stringify({ key: st.razorpay.keyId, order_id: st.razorpay.orderId, customer_id: st.razorpay.customerId, recurring: '1', amount: st.razorpay.amountPaise, currency: 'INR', name: 'Daji Cricket Ground', description: 'Approve auto-debit (₹1 is charged and refunded)', prefill: { name: user.name, email: user.email, contact: user.phone }, theme: { color: '#1c7a3e' } }).replace(/</g, '\\u003c');
      setCo({ mandateId: st.mandateId, html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0a0c0b"><script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>
        var o=${cfg}; o.handler=function(r){window.ReactNativeWebView.postMessage(JSON.stringify({ok:{paymentId:r.razorpay_payment_id,signature:r.razorpay_signature}}))};
        o.modal={ondismiss:function(){window.ReactNativeWebView.postMessage(JSON.stringify({dismiss:true}))}};
        window.onload=function(){new Razorpay(o).open()};</script></body></html>` });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const off = async () => { setErr(''); try { setM(await api<Mandate>('/api/autodebit', { method: 'DELETE' })); } catch (e: any) { setErr(e.message); } };

  if (co) return (
    <View style={{ height: 520, marginBottom: 14 }}>
      <WebView originWhitelist={CHECKOUT_ORIGINS} source={{ html: co.html, baseUrl: 'https://checkout.razorpay.com' }} style={{ flex: 1, backgroundColor: C.bg }}
        onShouldStartLoadWithRequest={(r) => isAllowedCheckoutUrl(r.url)}
        onMessage={async (e) => {
          const id = co.mandateId; setCo(null);
          const r = parseCheckoutMessage(e.nativeEvent.data);
          if (!r) { setErr('The approval window sent something unexpected, so nothing was changed.'); return; }
          if (r.kind === 'dismiss') return;
          try { setM(await api<Mandate>('/api/autodebit/confirm', { method: 'POST', body: { mandateId: id, paymentId: r.paymentId, signature: r.signature } })); } catch (er: any) { setErr(er.message); }
        }} />
    </View>
  );
  return (
    <View style={s.card}>
      <Text style={s.h2}>Auto-debit</Text>
      {m.status === 'active' ? (<>
        <Text style={s.muted}>On. The balance of each booking is charged from your bank {m.hoursBefore} hours before it starts, up to {inr(m.maxAmountPaise ?? 0)} at a time. You get a message each time.</Text>
        <Btn kind="outline" label="Turn off" onPress={off} style={{ marginTop: 10, marginBottom: 0 }} />
      </>) : (<>
        <Text style={[s.muted, { marginBottom: 8 }]}>Approve once with UPI and the balance of every booking is charged {m.hoursBefore} hours before it starts, so there is nothing to pay at the ground. You can turn it off any time. A ₹1 check is made and refunded.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{LIMITS.map((v) => <Chip key={v} label={`Up to ${inr(v)}`} on={max === v} onPress={() => setMax(v)} />)}</View>
        <Btn label="Set up auto-debit" onPress={start} busy={busy} style={{ marginBottom: 0 }} />
      </>)}
      {!!err && <Text style={s.err}>{err}</Text>}
    </View>
  );
}
