import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api, loadToken, setToken, setViewOwner } from './src/api';
import type { Booking, HoldResponse, User } from './src/types';
import { AuthScreen } from './src/AuthScreen';
import { BookScreen } from './src/BookScreen';
import { PayScreen } from './src/PayScreen';
import { MeScreen } from './src/MeScreen';
import { AskScreen } from './src/AskScreen';
import { StaffScreen } from './src/StaffScreen';
import { TasksScreen } from './src/TasksScreen';
import { ProfileScreen } from './src/ProfileScreen';
import { TeamScreen } from './src/TeamScreen';
import { PromoScreen } from './src/PromoScreen';
import { PlatformScreen } from './src/PlatformScreen';
import { AccountsScreen } from './src/AccountsScreen';
import { AcademyScreen } from './src/AcademyScreen';
import { MatchesScreen } from './src/MatchesScreen';
import { Avatar, Btn, Chip, Loading, s } from './src/ui';
import { registerForPush, unregisterPush, onNotificationTap } from './src/push';
import { C, inr } from './src/theme';
import { ADMIN_APP } from './src/variant';

// One app for everyone. What each person sees depends on who signed in:
//   customer     Book, Mine (bookings and academy), Ask AI, Profile
//   staff        Bookings, Tasks, Books, More, each only if their permissions allow it
//   coach        (staff with manage_academy / manage_matches) Academy and Matches under More
//   owner        the same, plus Promo codes, Team and Booking controls under More
//   super admin  the same as the owner, working inside the owner chosen under More
type Tab = 'book' | 'me' | 'ask' | 'profile' | 'bookings' | 'tasks' | 'accounts' | 'more';
type More = null | 'promo' | 'team' | 'platform' | 'profile' | 'academy' | 'matches';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('book');
  const [hold, setHold] = useState<HoldResponse | null>(null);
  const [done, setDone] = useState<{ b: Booking; paid: boolean } | null>(null);
  const [more, setMore] = useState<More>(null);
  const [owners, setOwners] = useState<User[]>([]);
  const [viewOwner, setView] = useState<string | null>(null);
  const [signin, setSignin] = useState(false); // customer app: the sign-in screen over the booking page

  useEffect(() => {
    (async () => {
      if (!(await loadToken())) { setUser(null); return; }
      try { setUser((await api<{ user: User }>('/api/me')).user); } catch { await setToken(null); setUser(null); }
    })();
  }, []);
  // once signed in, people who work for the ground land on their own first tab
  useEffect(() => { if (user && user.role !== 'customer') setTab((t) => (t === 'book' ? 'tasks' : t)); }, [user?.id]);
  useEffect(() => { if (user) void registerForPush(); }, [user?.id]);
  // the super admin works inside one owner's desk at a time
  useEffect(() => {
    if (user?.role !== 'super_admin') return;
    api<{ items: User[] }>('/api/admin/users?role=owner&limit=100')
      .then((r) => { setOwners(r.items); setView((cur) => { const id = cur ?? r.items[0]?.id ?? null; setViewOwner(id); return id; }); })
      .catch(() => {});
  }, [user?.role]);
  useEffect(() => onNotificationTap(() => { setHold(null); setDone(null); setMore(null); setTab(user && user.role !== 'customer' ? 'tasks' : 'me'); }), [user?.role]);
  const signOut = useCallback(async () => { await unregisterPush(); await setToken(null); setViewOwner(null); setUser(null); setHold(null); setDone(null); setMore(null); setTab('book'); }, []);

  if (user === undefined) return <View style={s.screen}><Loading /></View>;
  if (user === null && ADMIN_APP) return <><StatusBar style="light" /><AuthScreen admin onUser={setUser} /></>;
  if (user === null) {
    // Guests open straight on the booking page and only sign in when they hold a slot or open their own pages.
    const ask = () => setSignin(true);
    return (
      <View style={s.screen}>
        <StatusBar style="light" />
        <View style={{ flex: 1, display: signin ? 'none' : 'flex' }}><BookScreen onHold={() => {}} onNeedSignIn={ask} /></View>
        {signin && <AuthScreen onUser={(u) => { setSignin(false); setUser(u); }} onBack={() => setSignin(false)} note="Sign in to hold your slot. Your day and time stay as you left them." />}
        {!signin && (
          <View style={{ flexDirection: 'row', borderTopColor: C.line, borderTopWidth: 1, backgroundColor: C.panel, paddingBottom: 18 }}>
            {([['book', 'Book'], ['signin', 'Sign in']] as [string, string][]).map(([id, name]) => (
              <Pressable key={id} onPress={() => (id === 'signin' ? ask() : setTab(id as Tab))} style={{ flex: 1, alignItems: 'center', paddingVertical: 14 }}>
                <Text style={{ color: tab === id ? C.gold : C.muted, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>{name}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }
  if (ADMIN_APP === (user.role === 'customer')) {
    return (
      <View style={[s.screen, s.pad, { paddingTop: 90 }]}>
        <StatusBar style="light" />
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
  const boss = user.role === 'owner' || user.role === 'super_admin';
  const deskKey = viewOwner ?? 'self'; // a different owner reloads the screen

  let body: React.ReactNode;
  if (!customer) {
    if (tab === 'bookings' && bookingsOk) body = <StaffScreen key={deskKey} user={user} />;
    else if (tab === 'accounts' && accountsOk) body = <AccountsScreen key={deskKey} />;
    else if (tab === 'more') {
      if (more === 'promo') body = <PromoScreen key={deskKey} />;
      else if (more === 'team') body = <TeamScreen key={deskKey} />;
      else if (more === 'platform') body = <PlatformScreen />;
      else if (more === 'academy' && perm('manage_academy')) body = <AcademyScreen key={deskKey} />;
      else if (more === 'matches' && perm('manage_matches')) body = <MatchesScreen key={deskKey} />;
      else if (more === 'profile') body = <ProfileScreen user={user} onUser={setUser} onSignOut={signOut} />;
      else body = (
        <View style={[s.screen, s.pad, { paddingTop: 60 }]}>
          <Text style={s.eyebrow}>{user.role === 'super_admin' ? 'Super admin' : user.role === 'owner' ? 'Owner' : 'Team'}</Text>
          <Text style={s.h1}>More</Text>
          <Pressable onPress={() => setMore('profile')} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
            <Avatar name={user.name} url={user.avatarUrl} size={48} />
            <View style={{ marginLeft: 12 }}><Text style={s.text}>{user.name}</Text><Text style={s.muted}>Your profile and sign out</Text></View>
          </Pressable>
          {user.role === 'super_admin' && owners.length > 0 && (
            <><Text style={s.muted}>Working inside</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}>{owners.map((o) => <Chip key={o.id} label={o.name} on={viewOwner === o.id} onPress={() => { setView(o.id); setViewOwner(o.id); }} />)}</View></>
          )}
          {perm('manage_academy') && <Btn kind="outline" label="Academy: attendance and report cards" onPress={() => setMore('academy')} />}
          {perm('manage_matches') && <Btn kind="outline" label="Matches and live scoring" onPress={() => setMore('matches')} />}
          {boss && <Btn kind="outline" label="Promo codes" onPress={() => setMore('promo')} />}
          {boss && <Btn kind="outline" label="Team" onPress={() => setMore('team')} />}
          {boss && <Btn kind="outline" label="Booking controls" onPress={() => setMore('platform')} />}
          <Btn kind="ghost" label="Sign out" onPress={signOut} />
        </View>
      );
    } else body = <TasksScreen key={deskKey} user={user} />;
  } else if (done) {
    body = (
      <View style={[s.screen, s.pad, { paddingTop: 90 }]}>
        <Text style={s.eyebrow}>{done.paid && done.b.status === 'confirmed' ? 'Confirmed' : done.paid ? 'Payment received' : 'Reference sent'}</Text>
        <Text style={s.h1}>{done.paid && done.b.status === 'confirmed' ? "You're booked" : 'Thank you'}</Text>
        <Text style={[s.muted, { marginBottom: 18 }]}>{done.paid ? `${done.b.groundName}, ${done.b.date}. Paid ${inr(done.b.paidPaise)}${done.b.balancePaise > 0 ? `, balance ${inr(done.b.balancePaise)} at the ground` : ''}.` : 'We will confirm the booking once the payment is checked. You will see it under My dashboard.'}</Text>
        <Btn label="My dashboard" onPress={() => { setDone(null); setTab('me'); }} /><Btn kind="outline" label="Book another" onPress={() => { setDone(null); setTab('book'); }} />
      </View>
    );
  } else if (hold) body = <PayScreen hold={hold} user={user} onBack={() => setHold(null)} onDone={(b, paid) => { setHold(null); setDone({ b, paid }); }} />;
  else if (tab === 'book') body = <BookScreen onHold={setHold} />;
  else if (tab === 'me') body = <MeScreen onSignOut={signOut} user={user} />;
  else if (tab === 'profile') body = <ProfileScreen user={user} onUser={setUser} onSignOut={signOut} />;
  else body = <AskScreen />;

  const tabs: [Tab, string][] = customer
    ? [['book', 'Book'], ['me', 'Mine'], ['ask', 'Ask AI'], ['profile', 'Profile']]
    : [...(bookingsOk ? [['bookings', 'Bookings'] as [Tab, string]] : []), ['tasks', 'Tasks'], ...(accountsOk ? [['accounts', 'Books'] as [Tab, string]] : []), ['more', 'More']];
  return (
    <View style={s.screen}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>{body}</View>
      {!hold && (
        <View style={{ flexDirection: 'row', borderTopColor: C.line, borderTopWidth: 1, backgroundColor: C.panel, paddingBottom: 18 }}>
          {tabs.map(([id, name]) => (
            <Pressable key={id} onPress={() => { setDone(null); setMore(null); setTab(id); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 14 }}>
              <Text style={{ color: tab === id ? C.gold : C.muted, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>{name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
