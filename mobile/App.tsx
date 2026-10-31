import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, loadToken, serverSignOut, setBusiness, setToken, setViewOwner } from './src/api';
import type { Booking, HoldResponse, User } from './src/types';
import { AuthScreen } from './src/AuthScreen';
import { BookScreen } from './src/BookScreen';
import { PayScreen } from './src/PayScreen';
import { MeScreen } from './src/MeScreen';
import { AskScreen } from './src/AskScreen';
import { StaffScreen, type View_ as StaffView } from './src/StaffScreen';
import { HomeScreen, type HomeGo } from './src/HomeScreen';
import { CustomerHome } from './src/CustomerHome';
import { AuctionScreen } from './src/AuctionScreen';
import { FantasyScreen } from './src/FantasyScreen';
import { LiveScreen } from './src/LiveScreen';
import { TasksScreen } from './src/TasksScreen';
import { ProfileScreen } from './src/ProfileScreen';
import { TeamScreen } from './src/TeamScreen';
import { PromoScreen } from './src/PromoScreen';
import { PlatformScreen } from './src/PlatformScreen';
import { AccountsScreen } from './src/AccountsScreen';
import { AcademyScreen } from './src/AcademyScreen';
import { MatchesScreen } from './src/MatchesScreen';
import { DeskScreen } from './src/DeskScreen';
import { PayrollScreen } from './src/PayrollScreen';
import { ComplianceScreen } from './src/ComplianceScreen';
import { RefundsScreen } from './src/RefundsScreen';
import { CostsScreen } from './src/CostsScreen';
import { RemindersScreen } from './src/RemindersScreen';
import { CardsScreen } from './src/CardsScreen';
import { CashScreen } from './src/CashScreen';
import { CombinedScreen } from './src/CombinedScreen';
import { ConstructionScreen } from './src/ConstructionScreen';
import { SettingsScreen } from './src/SettingsScreen';
import { Avatar, Btn, Chip, Icon, type IconName, ListCard, ListRow, Loading, Steps, s, refreshStyles } from './src/ui';
import { Appearance } from './src/photo';
import * as SecureStore from 'expo-secure-store';
import { Intro } from './src/Intro';
import { registerForPush, unregisterPush, onNotificationTap } from './src/push';
import { C, inr, mode, niceDate, setMode, tint, type Mode } from './src/theme';
import { ADMIN_APP } from './src/variant';
import { useWake } from './src/fresh';
import { lockOn, setLockOn, useLock } from './src/lock';
import { LockScreen } from './src/LockScreen';
import { parseVoiceLink, voiceOn, type VoiceRequest } from './src/voice';
import { Lang, isLang, rememberLang, savedLang, translator, useLang, type UiLang } from './src/lang';

// One app for everyone. What each person sees depends on who signed in:
//   guest        Book, Live, Sign in
//   customer     Book, Bookings (My Bookings and academy), Live score, the assistant (shown under the name the person picked), Profile
//   staff        Home, Bookings, Tasks, the assistant, More (Books is under More and on Home), each only if their permissions allow it
//   coach        (staff with manage_academy / manage_matches) Academy and Matches under More
//   messages     (staff with send_broadcasts / view_customers) WhatsApp reminders and Business cards under More
//   owner        the same, plus Promo codes, Team, Booking controls, Staff pay and Compliance under More
//   super admin  the same as the owner, working inside the owner chosen under More, plus Refunds and Software costs
type Tab = 'home' | 'book' | 'me' | 'live' | 'ask' | 'profile' | 'bookings' | 'tasks' | 'more' | 'signin' | 'auctions' | 'fantasy';
type More = null | 'accounts' | 'promo' | 'team' | 'platform' | 'profile' | 'academy' | 'matches' | 'desk' | 'payroll' | 'compliance' | 'refunds' | 'costs' | 'reminders' | 'cards' | 'settings' | 'cash' | 'combined' | 'construction';

const TAB_ICON: Record<string, IconName> = { home: 'home', book: 'calendar', me: 'receipt', live: 'radio', ask: 'sparkles', profile: 'person-circle', bookings: 'calendar', tasks: 'checkbox', more: 'grid', signin: 'log-in' };
/** The bar of tabs along the bottom: an icon over each name; the open tab is filled green. */
function TabBar({ tabs, on, onPick, bottom }: { tabs: [string, string][]; on: string; onPick: (id: string) => void; bottom: number }) {
  return (
    <View style={{ flexDirection: 'row', borderTopColor: C.line, borderTopWidth: 1, backgroundColor: C.bar, paddingHorizontal: 6, paddingTop: 8, paddingBottom: Math.max(12, bottom) }}>
      {tabs.map(([id, name]) => {
        const sel = on === id, icon = TAB_ICON[id] ?? 'ellipse';
        return (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: sel }} accessibilityLabel={name} onPress={() => onPick(id)} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <View style={{ paddingVertical: 4, paddingHorizontal: 14, borderRadius: 999, backgroundColor: sel ? tint(C.onBg, 0.14) : 'transparent' }}>
              <Icon name={(sel ? icon : `${icon}-outline`) as IconName} size={22} color={sel ? C.onBg : C.headMuted} />
            </View>
            <Text numberOfLines={1} style={{ color: sel ? C.onBg : C.headMuted, fontSize: 11, fontWeight: sel ? '800' : '600' }}>{name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AppInner({ theme }: { theme: Mode }) {
  const insets = useSafeAreaInsets(); // Android draws behind the system bars now, so the tab bar clears the gesture or button bar itself
  void theme; // a new value makes the whole app draw again with the new colours
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const { lang, t, setLang } = useLang();
  // a signed-in person's screen language comes from their profile, so it is the same on every phone and on the website. Someone who never
  // saved one keeps the language they picked before signing in or registering, and it is saved to their profile, so nobody is switched
  // back to English halfway through booking. If that save fails the screens stay in their pick on this phone, and it is tried again next time.
  const adopting = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (user.languageChosen) { if (isLang(user.language)) setLang(user.language); return; }
    if (lang === 'en' || adopting.current) return;
    adopting.current = true;
    api<{ user: User }>('/api/me', { method: 'PATCH', body: { language: lang } }).then((r) => setUser(r.user), () => {}).finally(() => { adopting.current = false; });
  }, [user, lang, setLang]);
  const [tab, setTab] = useState<Tab>('home');
  const [hold, setHold] = useState<HoldResponse | null>(null);
  const [done, setDone] = useState<{ b: Booking; paid: boolean } | null>(null);
  const [more, setMore] = useState<More>(null);
  const [owners, setOwners] = useState<User[]>([]);
  const [viewOwner, setView] = useState<string | null>(null);
  const [signin, setSignin] = useState(false); // customer app: the sign-in screen over the booking page
  const wake = useWake(!!hold); // back after a while: the open screen loads again (never in the middle of paying)
  const [locked, unlocked, lockNow] = useLock(!!user); // Face ID / fingerprint, when the person turned it on under Profile
  // a voice shortcut (Siri, an Android shortcut) opens the app at a link; it waits here until someone is signed in
  const [voiceLink, setVoiceLink] = useState<VoiceRequest | null>(null);
  const [voiceAsk, setVoiceAsk] = useState<{ q: string; n: number } | null>(null);
  const [taskDraft, setTaskDraft] = useState<{ title: string; n: number } | null>(null);
  const [staffView, setStaffView] = useState<{ v: StaffView; n: number }>({ v: 'today', n: 0 }); // Home can open Bookings on one of its tabs
  const [meStart, setMeStart] = useState<{ v: 'ground' | 'academy'; n: number }>({ v: 'ground', n: 0 }); // customer Home can open My Bookings on Academy
  const [voiceNote, setVoiceNote] = useState('');
  // a portfolio owner, or a team member on more than one business's team, works in one business at a time (server areas.ts)
  const [businesses, setBusinesses] = useState<{ id: string; businessName: string; own: boolean; permissions?: string[] }[]>([]);
  const [biz, setBiz] = useState<string | null>(null);
  const [homePerms, setHomePerms] = useState<string[] | undefined>(undefined);
  const [cashSpend, setCashSpend] = useState(0); // a voice shortcut opens Cash on the spend form
  useEffect(() => {
    const take = (url: string | null) => { const v = parseVoiceLink(url); if (v) setVoiceLink(v); };
    void Linking.getInitialURL().then(take).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => take(e.url));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!voiceLink || !user) return;
    const v = voiceLink; setVoiceLink(null);
    (async () => {
      // the business switch (Settings) and this phone's own switch (Profile) must both be on; a voice link never opens more than a tap would
      const biz = await api<{ voiceEnabled?: boolean }>('/api/config').then((c) => c.voiceEnabled !== false).catch(() => true);
      if (!biz) { setVoiceNote('Voice shortcuts are switched off for this business.'); return; }
      if (!(await voiceOn())) { setVoiceNote('Voice shortcuts are off on this phone. Turn them on under Profile, Voice Shortcuts.'); return; }
      setVoiceNote(''); setHold(null); setDone(null); setMore(null);
      const a = v.action;
      if (a.screen === 'tasks') { setTaskDraft({ title: v.title ?? '', n: Date.now() }); setTab('tasks'); }
      else if (a.screen === 'cash' && user.role !== 'customer') { setCashSpend(Date.now()); setTab('more'); setMore('cash'); }
      else if (a.screen === 'construction' && user.role !== 'customer') { setTab('more'); setMore('construction'); }
      else if (a.screen === 'book' || a.screen === 'live') setTab(a.screen);
      // hosted tournaments are a customer screen; on the staff app the link opens the assistant instead
      else if (a.screen === 'auctions' && user.role === 'customer') setTab('auctions');
      // fantasy teams are picked from a customer account; on the staff app the link opens the assistant instead
      else if (a.screen === 'fantasy' && user.role === 'customer') setTab('fantasy');
      else { setVoiceAsk(a.question || v.question ? { q: (v.question ?? a.question)!, n: Date.now() } : null); setTab('ask'); }
    })();
  }, [voiceLink, user?.id]);

  useEffect(() => {
    (async () => {
      if (!(await loadToken())) { setUser(null); return; }
      try { const me = (await api<{ user: User }>('/api/me')).user; if (await lockOn()) lockNow(); setUser(me); } catch { await setToken(null); await setLockOn(false); setUser(null); }
    })();
  }, []);
  // once signed in, people who work for the ground land on their own Home
  useEffect(() => { if (user) void registerForPush(); }, [user?.id]);
  // the super admin works inside one owner's desk at a time
  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    api<{ items: User[] }>('/api/admin/users?role=owner&limit=100')
      .then((r) => { setOwners(r.items); setView((cur) => { const id = cur ?? r.items[0]?.id ?? null; setViewOwner(id); return id; }); })
      .catch(() => {});
  }, [user?.role]);
  useEffect(() => {
    setBusinesses([]); setBiz(null); setBusiness(null); setHomePerms(user?.permissions);
    if (user?.role === 'owner') api<{ items: { id: string; businessName: string; own: boolean }[] }>('/api/me/portfolio').then((r) => setBusinesses(r.items)).catch(() => {});
    else if (user?.role === 'staff') api<{ items: { id: string; businessName: string; own: boolean; permissions: string[] }[] }>('/api/me/businesses').then((r) => setBusinesses(r.items)).catch(() => {});
  }, [user?.id, user?.role]);
  /** Work in another business: every request carries it, and a team member has the rights given there. */
  const pickBusiness = (b: { id: string; own: boolean; permissions?: string[] }) => {
    setBiz(b.own ? null : b.id); setBusiness(b.own ? null : b.id); setMore(null); setTab('home');
    if (user?.role === 'staff') setUser((u) => (u ? { ...u, permissions: b.own ? homePerms : b.permissions } : u));
  };
  useEffect(() => onNotificationTap(() => { setHold(null); setDone(null); setMore(null); setTab(user && user.role !== 'customer' ? 'tasks' : 'me'); }), [user?.role]);
  const signOut = useCallback(async () => { await unregisterPush(); await serverSignOut(); await setToken(null); await setLockOn(false); setViewOwner(null); setBusiness(null); setUser(null); setHold(null); setDone(null); setMore(null); setTab('home'); }, []);

  if (user === undefined) return <View style={s.screen}><Loading /></View>;
  if (user === null && ADMIN_APP) return <><StatusBar style={mode === 'light' ? 'dark' : 'light'} /><AuthScreen admin onUser={setUser} /></>;
  if (user === null) {
    // Guests open straight on the booking page and only sign in when they hold a slot or open their own pages.
    const ask = () => setSignin(true);
    return (
      <View style={s.screen}>
        <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
        <View style={{ flex: 1, display: signin || tab !== 'book' ? 'none' : 'flex' }}><BookScreen onHold={() => {}} onNeedSignIn={ask} /></View>
        {!signin && tab === 'live' && <LiveScreen />}
        {!signin && tab === 'home' && <CustomerHome user={null} aiName="" go={(to) => { if (to === 'book' || to === 'live') setTab(to); else ask(); }} />}
        {signin && <AuthScreen onUser={(u) => { setSignin(false); setUser(u); }} onBack={() => setSignin(false)} note={t('auth.holdNote')} />}
        <TabBar tabs={[['home', t('tab.home')], ['book', t('tab.book')], ['live', t('tab.live')], ['signin', t('tab.signin')]]} on={signin ? 'signin' : tab === 'live' || tab === 'home' ? tab : 'book'} onPick={(id) => { if (id === 'signin') ask(); else { setSignin(false); setTab(id as Tab); } }} bottom={insets.bottom} />
      </View>
    );
  }
  if (ADMIN_APP === (user.role === 'customer')) {
    return (
      <View style={[s.screen, s.pad, { paddingTop: 90 }]}>
        <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
        <Text style={s.eyebrow}>{ADMIN_APP ? 'Daji Admin' : 'Daji Cricket Ground'}</Text>
        <Text style={s.h1}>{ADMIN_APP ? 'This app is for the ground team' : 'Please use the Daji Admin app'}</Text>
        <Text style={[s.muted, { marginBottom: 18 }]}>{ADMIN_APP ? 'Your account is a customer account. Book and manage your games in the Daji Cricket Ground app.' : 'Your account belongs to the ground team. Sign in to the Daji Admin app to work with bookings, tasks and accounts.'}</Text>
        <Btn label="Sign out" onPress={signOut} />
      </View>
    );
  }
  const customer = user.role === 'customer';
  const perm = (p: string) => user.role !== 'staff' || (user.permissions ?? []).includes(p);
  const bookingsOk = perm('manage_bookings') || perm('verify_payments') || perm('record_payments');
  const accountsOk = perm('manage_accounting') || perm('view_reports');
  // the same rule as the server (construction.ts seesConstruction): the owner, or staff who run jobs, keep the books or see reports
  const constructionOk = perm('manage_tasks') || perm('manage_accounting') || perm('view_reports');
  const boss = user.role === 'owner' || user.role === 'super_admin';
  const deskKey = `${viewOwner ?? 'self'}:${biz ?? 'home'}`; // a different owner or business reloads the screen
  // the assistant's tab shows the name this person picked, exactly as given; a long one is cut to fit the bar
  const aiName = user.aiName || 'Ask AI';
  const aiTab = aiName.length > 10 ? `${aiName.slice(0, 9)}…` : aiName;

  let body: React.ReactNode;
  if (!customer) {
    const homeGo = (to: HomeGo) => {
      setMore(null);
      if (to === 'bookings' || to === 'payments' || to === 'block') { setStaffView((x) => ({ v: to === 'bookings' ? 'today' : to, n: x.n + 1 })); setTab('bookings'); }
      else if (to === 'tasks' || to === 'ask') setTab(to);
      else { setTab('more'); setMore(to); }
    };
    if (tab === 'home') body = <HomeScreen key={deskKey} user={user} aiName={aiName} go={homeGo} />;
    else if (tab === 'bookings' && bookingsOk) body = <StaffScreen key={`${deskKey}:${staffView.n}`} user={user} start={staffView.v} />;
    else if (tab === 'more') {
      if (more === 'accounts' && accountsOk) body = <AccountsScreen key={deskKey} />;
      else if (more === 'promo') body = <PromoScreen key={deskKey} />;
      else if (more === 'team') body = <TeamScreen key={deskKey} />;
      else if (more === 'platform') body = <PlatformScreen />;
      else if (more === 'desk' && boss) body = <DeskScreen key={deskKey} />;
      else if (more === 'payroll' && boss) body = <PayrollScreen key={deskKey} />;
      else if (more === 'compliance' && boss) body = <ComplianceScreen />;
      else if (more === 'refunds' && user.role === 'super_admin') body = <RefundsScreen />;
      else if (more === 'costs' && user.role === 'super_admin') body = <CostsScreen />;
      else if (more === 'reminders' && perm('send_broadcasts')) body = <RemindersScreen key={deskKey} />;
      else if (more === 'cards' && perm('view_customers')) body = <CardsScreen key={deskKey} />;
      else if (more === 'cash' && (boss || perm('manage_tasks'))) body = <CashScreen key={`${deskKey}:${cashSpend}`} user={user} startSpend={cashSpend || undefined} />;
      else if (more === 'combined' && user.role === 'owner') body = <CombinedScreen key={deskKey} />;
      else if (more === 'construction' && constructionOk) body = <ConstructionScreen key={deskKey} user={user} />;
      else if (more === 'settings' && boss) body = <SettingsScreen user={user} />;
      else if (more === 'academy' && perm('manage_academy')) body = <AcademyScreen key={deskKey} />;
      else if (more === 'matches' && perm('manage_matches')) body = <MatchesScreen key={deskKey} />;
      else if (more === 'profile') body = <ProfileScreen user={user} onUser={setUser} onSignOut={signOut} />;
      else body = (
        <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 58 }]}>
          <Text style={s.eyebrow}>{user.role === 'super_admin' ? 'Super admin' : user.role === 'owner' ? 'Owner' : 'Team'}</Text>
          <Text style={s.h1}>More</Text>
          <Pressable accessibilityRole="button" onPress={() => setMore('profile')} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }]}>
            <Avatar name={user.name} url={user.avatarUrl} size={48} />
            <View style={{ flex: 1 }}><Text style={[s.text, { fontWeight: '700' }]}>{user.name}</Text><Text style={s.muted}>Profile, appearance, voice and sign out</Text></View>
            <Icon name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
          {user.role === 'super_admin' && owners.length > 0 && (
            <><Text style={s.muted}>Working inside</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}>{owners.map((o) => <Chip key={o.id} label={o.name} on={viewOwner === o.id} onPress={() => { setView(o.id); setViewOwner(o.id); }} />)}</View></>
          )}
          {businesses.length > 1 && (
            <><Text style={s.muted}>Working in</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}>{businesses.map((b) => <Chip key={b.id} label={b.businessName} on={(biz ?? '') === (b.own ? '' : b.id)} onPress={() => pickBusiness(b)} />)}</View></>
          )}
          <MenuGroup title="Ground" rows={[
            perm('manage_matches') && ['trophy-outline', 'Matches and live scoring', 'Score ball by ball; customers see it under Live', 'matches'],
            perm('manage_academy') && ['school-outline', 'Academy', 'Attendance and report cards', 'academy'],
            boss && ['briefcase-outline', 'Desk', 'Tournaments, members, contacts, bills, transactions', 'desk'],
            boss && ['pricetag-outline', 'Promo codes', '', 'promo'],
            boss && ['people-outline', 'Team', 'People and what they may do', 'team'],
            boss && ['options-outline', 'Booking controls', '', 'platform'],
            boss && ['settings-outline', 'Settings', 'Booking rules, contact and UPI', 'settings'],
          ]} onPick={setMore} />
          <MenuGroup title="Construction" rows={[
            constructionOk && ['construct-outline', 'Construction projects', 'Orders, goods received, measured work, defects', 'construction'],
          ]} onPick={setMore} />
          <MenuGroup title="People" rows={[
            perm('send_broadcasts') && ['logo-whatsapp', 'WhatsApp reminders', '', 'reminders'],
            perm('view_customers') && ['id-card-outline', 'Business cards', '', 'cards'],
          ]} onPick={setMore} />
          <MenuGroup title="Money" rows={[
            user.role === 'owner' && ['albums-outline', 'All my businesses', 'Your businesses side by side, read-only', 'combined'],
            accountsOk && ['wallet-outline', 'Books', 'Accounts, money in and out', 'accounts'],
            (boss || perm('manage_tasks')) && ['card-outline', 'Cash', boss ? 'Cash your team holds, spends to sign' : 'Cash you hold, spends and receipts', 'cash'],
            boss && ['cash-outline', 'Staff pay and attendance', '', 'payroll'],
            boss && ['shield-checkmark-outline', 'Compliance', '', 'compliance'],
            user.role === 'super_admin' && ['return-down-back-outline', 'Refunds to authorise', '', 'refunds'],
            user.role === 'super_admin' && ['receipt-outline', 'Software costs', '', 'costs'],
          ]} onPick={setMore} />
          <ListCard><ListRow icon="log-out-outline" title="Sign out" tone="danger" onPress={signOut} right={<View />} last /></ListCard>
        </ScrollView>
      );
    } else if (tab === 'ask') body = <AskScreen user={user} onUser={setUser} voice={voiceAsk} />;
    else body = <TasksScreen key={`${deskKey}:${taskDraft?.n ?? 0}`} user={user} draftTitle={taskDraft?.title} />;
  } else if (done) {
    body = (
      <View style={[s.screen, s.pad, { paddingTop: 90 }]}>
        <Steps at={4} />
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: done.paid && done.b.status === 'confirmed' ? C.strong : C.soft, alignItems: 'center', justifyContent: 'center', marginTop: 18, marginBottom: 14 }}>
          <Text style={{ color: done.paid && done.b.status === 'confirmed' ? C.onStrong : C.gold, fontSize: 30, fontWeight: '800' }}>{done.paid && done.b.status === 'confirmed' ? '✓' : '…'}</Text>
        </View>
        <Text style={s.eyebrow}>{done.paid && done.b.status === 'confirmed' ? t('done.confirmed') : done.paid ? t('done.paymentReceived') : t('done.refSent')}</Text>
        <Text style={s.h1}>{done.paid && done.b.status === 'confirmed' ? t('done.booked') : t('done.thanks')}</Text>
        <Text style={[s.muted, { marginBottom: 18 }]}>{done.paid ? t(done.b.balancePaise > 0 ? 'done.paidBalance' : 'done.paid', { ground: done.b.groundName, date: niceDate(done.b.date), paid: inr(done.b.paidPaise), balance: inr(done.b.balancePaise) }) : t('done.checking')}</Text>
        <Btn label={t('me.title')} onPress={() => { setDone(null); setTab('me'); }} /><Btn kind="outline" label={t('done.another')} onPress={() => { setDone(null); setTab('book'); }} />
      </View>
    );
  } else if (hold) body = <PayScreen hold={hold} user={user} onBack={() => setHold(null)} onDone={(b, paid) => { setHold(null); setDone({ b, paid }); }} />;
  else if (tab === 'home') body = <CustomerHome user={user} aiName={aiName} go={(to) => { if (to === 'me' || to === 'academy') { setMeStart((x) => ({ v: to === 'academy' ? 'academy' : 'ground', n: x.n + 1 })); setTab('me'); } else setTab(to); }} />;
  else if (tab === 'book') body = <BookScreen onHold={setHold} />;
  else if (tab === 'me') body = <MeScreen key={meStart.n} start={meStart.v} onSignOut={signOut} user={user} />;
  else if (tab === 'profile') body = <ProfileScreen user={user} onUser={setUser} onSignOut={signOut} />;
  else if (tab === 'live') body = <LiveScreen />;
  else if (tab === 'auctions') body = <AuctionScreen aiName={aiName} onBack={() => setTab('home')} />;
  else if (tab === 'fantasy') body = <FantasyScreen onBack={() => setTab('home')} />;
  else body = <AskScreen user={user} onUser={setUser} voice={voiceAsk} />;

  const tabs: [Tab, string][] = customer
    ? [['home', t('tab.home')], ['me', t('tab.bookings')], ['ask', aiTab], ['live', t('tab.live')], ['profile', t('tab.profile')]]
    : [['home', 'Home'], ...(bookingsOk ? [['bookings', 'Bookings'] as [Tab, string]] : []), ['tasks', 'Tasks'], ['ask', aiTab], ['more', 'More']];
  return (
    <View style={s.screen}>
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
      {!!voiceNote && <Pressable onPress={() => setVoiceNote('')} style={{ backgroundColor: C.soft, paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 16 }}><Text style={s.text}>{voiceNote}</Text></Pressable>}
      <View key={wake} style={{ flex: 1 }}>{body}</View>
      {!hold && <TabBar tabs={tabs} on={customer && (tab === 'book' || tab === 'auctions' || tab === 'fantasy') ? 'home' : tab} onPick={(id) => { setDone(null); setMore(null); setTab(id as Tab); }} bottom={insets.bottom} />}
      {locked && <LockScreen name={user.name} onUnlock={unlocked} onSignOut={signOut} />}
    </View>
  );
}

/** One group of the More list; rows the person may not use are left out, and a group with none is not drawn. */
function MenuGroup({ title, rows, onPick }: { title: string; rows: (false | [IconName, string, string, More])[]; onPick: (m: More) => void }) {
  const shown = rows.filter(Boolean) as [IconName, string, string, More][];
  if (!shown.length) return null;
  return (<>
    <Text style={[s.note, { fontWeight: '700', marginTop: 8, marginBottom: 6 }]}>{title}</Text>
    <ListCard>{shown.map(([icon, label, sub, to], i) => <ListRow key={String(to)} icon={icon} title={label} sub={sub || undefined} onPress={() => onPick(to)} last={i === shown.length - 1} />)}</ListCard>
  </>);
}

const THEME_KEY = 'daji.theme';
/** The whole app, with the light / dark choice (remembered on this phone, applied everywhere) and the opening animation. */
export default function App() {
  const [m, setM] = useState<Mode>(mode);
  const [intro, setIntro] = useState(true);
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<UiLang>('en');
  useEffect(() => { (async () => { try { const v = await SecureStore.getItemAsync(THEME_KEY); if (v === 'light' || v === 'dark') { setMode(v); refreshStyles(); setM(v); } } catch { /* keep light */ } setLangState(await savedLang()); setReady(true); })(); }, []);
  const setLang = useCallback((l: UiLang) => { setLangState(l); rememberLang(l); }, []);
  const flip = () => { const next: Mode = m === 'dark' ? 'light' : 'dark'; setMode(next); refreshStyles(); setM(next); SecureStore.setItemAsync(THEME_KEY, next).catch(() => {}); };
  if (!ready) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  return (
    <SafeAreaProvider>
      <Appearance.Provider value={{ mode: m, flip }}>
        <Lang.Provider value={{ lang, t: translator(lang), setLang }}>
          <View style={{ flex: 1, backgroundColor: C.bg }}>
            <AppInner theme={m} />
            {intro && <Intro onDone={() => setIntro(false)} />}
          </View>
        </Lang.Provider>
      </Appearance.Provider>
    </SafeAreaProvider>
  );
}
