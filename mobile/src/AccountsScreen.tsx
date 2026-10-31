import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from './Text';
import { api } from './api';
import { KV, Loading, Section, s, ScreenHead, Empty } from './ui';
import { C, inr } from './theme';

interface Period { month?: string; revenuePaise: number; expensesPaise: number; netProfitPaise: number }
interface Overview { asOf: string; thisMonth: Period; lastMonth: Period; financialYearToDate: Period; cashAndBankPaise: number; advancesHeldPaise: number; accountCreditOwedPaise: number; customersOweYouPaise: number; gstPayablePaise: number; uncategorised: { count: number; amountPaise: number }; empty: boolean }

const Block = ({ title, p }: { title: string; p: Period }) => (<View style={s.card}><Text style={[s.text, { fontWeight: '700', marginBottom: 6 }]}>{title}</Text><KV k="Income" v={inr(p.revenuePaise)} /><KV k="Spending" v={inr(p.expensesPaise)} /><KV k="Profit" v={inr(p.netProfitPaise)} bold /></View>);

/** The books at a glance. Entering expenses and the detailed reports stay on the website. */
export function AccountsScreen() {
  const [o, setO] = useState<Overview | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { setO(await api<Overview>('/api/accounting/overview')); setErr(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 60 }]} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.gold} />}>
      <ScreenHead eyebrow="Accounting" title="The books" />
      {!!err && <Text style={s.err}>{err}</Text>}
      {!o ? (err ? null : <Loading />) : o.empty ? <Empty icon="wallet-outline" text="Nothing recorded yet. Bookings and payments appear here as they happen." /> : (<>
        <Block title="This month" p={o.thisMonth} /><Block title="Last month" p={o.lastMonth} /><Block title="Financial year so far" p={o.financialYearToDate} />
        <Section>Where things stand</Section>
        <View style={s.card}>
          <KV k="Cash and bank" v={inr(o.cashAndBankPaise)} bold /><KV k="Customers owe you" v={inr(o.customersOweYouPaise)} /><KV k="Paid in advance" v={inr(o.advancesHeldPaise)} /><KV k="Account credit owed" v={inr(o.accountCreditOwedPaise)} />
          {o.gstPayablePaise !== 0 && <KV k="GST to pay" v={inr(o.gstPayablePaise)} />}{o.uncategorised.count > 0 && <KV k="Entries to sort" v={`${o.uncategorised.count} (${inr(o.uncategorised.amountPaise)})`} />}
        </View>
      </>)}
    </ScrollView>
  );
}
