import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { WebView } from 'react-native-webview';
import { api } from './api';
import { CHECKOUT_ORIGINS, isAllowedCheckoutUrl, parseCheckoutMessage } from './checkoutGuard';
import type { Booking, HoldResponse, User } from './types';
import { Badge, Btn, Field, KV, Steps, s } from './ui';
import { C, inr, niceDate } from './theme';

/** Payment for a held booking: Razorpay (a demo card on a demo server, real Checkout otherwise) or UPI with the reference number. */
/** With balance set this pays the exact difference a dearer move added to a confirmed booking: the same payment path, with no hold timer. */
export function PayScreen({ hold, user, onDone, onBack, balance }: { hold: HoldResponse; user: User; onDone: (b: Booking, paid: boolean) => void; onBack: () => void; balance?: boolean }) {
  const { booking: b, payment: p } = hold;
  const [left, setLeft] = useState(() => Math.max(0, (b.holdExpiresAt ?? 0) - Date.now()));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [utr, setUtr] = useState(''); const [checkout, setCheckout] = useState(false);
  useEffect(() => { const t = setInterval(() => setLeft(Math.max(0, (b.holdExpiresAt ?? 0) - Date.now())), 1000); return () => clearInterval(t); }, [b.holdExpiresAt]);
  const expired = !balance && left === 0;
  const mm = String(Math.floor(left / 60000)).padStart(2, '0'), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');

  const verify = async (r: { orderId: string; paymentId: string; signature: string }) => {
    const v = await api<{ booking: Booking }>('/api/payments/razorpay/verify', { method: 'POST', body: r });
    onDone(v.booking, true);
  };
  const demo = async (outcome: 'success' | 'failure') => {
    setErr(''); setBusy(true);
    try { const r = await api('/api/gateway/demo/pay', { method: 'POST', body: { orderId: p.razorpay!.orderId, outcome } }); await verify(r); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const sendUtr = async () => {
    setErr(''); setBusy(true);
    try { const r = await api<{ booking: Booking }>(`/api/bookings/${b.id}/upi-reference`, { method: 'POST', body: { utr: utr.trim() } }); onDone(r.booking, false); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (checkout && p.razorpay && !p.razorpay.demo) {
    const cfg = JSON.stringify({ key: p.razorpay.keyId, order_id: p.razorpay.orderId, amount: p.amountPaise, currency: 'INR', name: 'Daji Cricket Ground', description: `Booking ${b.ref}`, prefill: { name: user.name, email: user.email, contact: user.phone }, theme: { color: '#1c7a3e' } }).replace(/</g, '\\u003c');
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0a0c0b"><script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>
      var o=${cfg}; o.handler=function(r){window.ReactNativeWebView.postMessage(JSON.stringify({ok:{orderId:r.razorpay_order_id,paymentId:r.razorpay_payment_id,signature:r.razorpay_signature}}))};
      o.modal={ondismiss:function(){window.ReactNativeWebView.postMessage(JSON.stringify({dismiss:true}))}};
      window.onload=function(){new Razorpay(o).open()};</script></body></html>`;
    return (
      <View style={s.screen}>
        <WebView originWhitelist={CHECKOUT_ORIGINS} source={{ html, baseUrl: 'https://checkout.razorpay.com' }} style={{ flex: 1, backgroundColor: C.bg }}
          onShouldStartLoadWithRequest={(r) => isAllowedCheckoutUrl(r.url)}
          onMessage={async (e) => {
            // what the window says is only a hint: it must be the exact expected shape for this order, and the server verifies the payment itself
            const m = parseCheckoutMessage(e.nativeEvent.data, p.razorpay!.orderId);
            if (!m) { setErr('The payment window sent something unexpected. Nothing was charged by this app; check your bookings before paying again.'); setCheckout(false); return; }
            if (m.kind === 'dismiss') { setCheckout(false); return; }
            setCheckout(false);
            try { await verify({ orderId: m.orderId ?? p.razorpay!.orderId, paymentId: m.paymentId, signature: m.signature }); } catch (er: any) { setErr(er.message); }
          }} />
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: balance ? 60 : 90 }]} keyboardShouldPersistTaps="handled">
      {!balance && <Steps at={3} />}
      <Text style={s.eyebrow}>{balance ? 'Moved booking' : 'Slots held'}</Text>
      <Text style={s.h1}>{balance ? 'Pay the difference' : 'Complete your payment'}</Text>
      <Text style={[s.muted, { marginBottom: 16 }]}>{balance ? 'Your new time costs more. This is only the difference. What you paid before stays on the booking. The rest of the balance is paid at the ground as usual.' : `Held for ${mm}:${ss}. They are released if payment does not arrive in time.`}</Text>
      <View style={[s.card, { backgroundColor: C.soft, borderColor: C.soft }]}>
        <Text style={s.muted}>{balance ? 'Difference to pay now' : 'Amount to pay now'}</Text>
        <Text style={{ color: C.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 }}>{inr(p.amountPaise)}</Text>
      </View>
      <View style={s.card}>
        <KV k="Ground" v={b.groundName} /><KV k="Date" v={niceDate(b.date)} /><KV k="Slots" v={String(b.slotCount)} />
        <KV k="Total" v={inr(b.totalPaise)} /><KV k={balance ? 'Difference to pay now' : 'Pay now'} v={inr(p.amountPaise)} bold />
        {!balance && hold.creditAppliedPaise > 0 && <KV k="Account credit used" v={inr(hold.creditAppliedPaise)} />}
      </View>
      {hold.series && (<View style={s.card}><Text style={s.text}>Repeat booking: {hold.series.created} dates reserved.</Text>
        {hold.series.skipped.length > 0 && <Text style={s.muted}>Left out: {hold.series.skipped.map((x) => x.date).join(', ')}.</Text>}
        <Text style={s.muted}>The other dates are confirmed once this payment is done.</Text></View>)}
      {expired && <Text style={s.err}>The hold has run out. Go back and choose the slots again.</Text>}
      {p.mode === 'razorpay' && p.razorpay?.demo && (<>
        <Text style={[s.muted, { marginBottom: 10 }]}>Demo server: no real money moves.</Text>
        <Btn label={`Pay ${inr(p.amountPaise)} with the demo card`} onPress={() => demo('success')} busy={busy} disabled={expired} />
        <Btn kind="outline" label="Pretend the card is declined" onPress={() => demo('failure')} disabled={busy} />
      </>)}
      {p.mode === 'razorpay' && p.razorpay && !p.razorpay.demo && <Btn label={`Pay ${inr(p.amountPaise)}`} onPress={() => setCheckout(true)} disabled={expired} />}
      {p.mode === 'upi' && p.upi && (<>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}><Text style={[s.h2, { marginBottom: 0, marginRight: 8 }]}>Pay by UPI</Text><Badge label="Recommended" tone="ok" /></View>
        <View style={s.card}><KV k="Pay to UPI ID" v={p.upi.upiId} bold /><KV k="Name" v={p.upi.payee} /><KV k="Amount" v={inr(p.amountPaise)} /></View>
        <Btn kind="outline" label="Open my UPI app" onPress={() => { Linking.openURL(p.upi!.uri).catch(() => setErr('No UPI app was found. Pay to the UPI ID shown, then enter the reference below.')); }} />
        <Field label="After paying, the UPI reference (UTR)" value={utr} onChangeText={setUtr} keyboardType="number-pad" maxLength={30} />
        <Btn label="I have paid" onPress={sendUtr} busy={busy} disabled={utr.trim().length < 6 || expired} />
      </>)}
      {p.mode === 'none' && <Text style={s.muted}>Nothing to pay: your account credit covers this booking.</Text>}
      {!!err && <Text style={s.err}>{err}</Text>}
      {p.mode !== 'none' && <Text style={[s.muted, { textAlign: 'center', marginVertical: 6 }]}>🔒 Secure, encrypted payment</Text>}
      <Btn kind="ghost" label="Back" onPress={onBack} />
    </ScrollView>
  );
}
