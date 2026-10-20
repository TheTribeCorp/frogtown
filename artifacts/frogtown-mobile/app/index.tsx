import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Platform, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useState } from 'react';
import { useSession } from '@/providers/session';
import { Button, Label } from '@/components/ui';
import { InboxScreen } from '@/components/inbox';
import { errorText } from '@/lib/api';
import * as WebBrowser from 'expo-web-browser';
import { SessionGate } from '@/components/session-gate';

const highlights = [
  { icon: 'lock-closed-outline' as const, title: 'Private by design', detail: 'Your encrypted chats stay yours.' },
  { icon: 'people-outline' as const, title: 'One community', detail: 'XRPL and LadyChain, together.' },
  { icon: 'chatbubble-ellipses-outline' as const, title: 'Room for everyone', detail: 'Find your people in Frogtown.' },
];

function FrogtownMobileWelcome() {
  const colors = useColors();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (session.wallet) return <InboxScreen />;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView
        style={styles.safeArea}
        edges={['top', 'right', 'bottom', 'left']}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            Platform.OS === 'web' && styles.webInsets,
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <View style={[styles.brandMark, { backgroundColor: colors.primary, borderColor: colors.leaf }]}>
              <Image source={require('../assets/images/icon.png')} style={styles.brandImage} contentFit="cover" />
            </View>
            <View>
              <Text style={[styles.brandName, { color: colors.foreground }]}>Frogtown</Text>
              <Text style={[styles.brandMeta, { color: colors.mutedForeground }]}>XRPL  ·  LADYCHAIN</Text>
            </View>
          </View>

          <View style={{ gap: 12, marginBottom: 22 }}>
            <Button title={session.pending ? 'Return to wallet sign-in' : 'Sign in with Xaman or LadyChain'} busy={busy} onPress={() => {
              setBusy(true); setError('');
              void (session.pending ? WebBrowser.openBrowserAsync(session.pending.loginUrl) : session.beginSignIn())
                .catch((e) => setError(errorText(e))).finally(() => setBusy(false));
            }} />
            {session.pending && <>
              <Label>Approve in your browser, then return here. Waiting for wallet approval…</Label>
              <Button secondary title="Check approval" onPress={() => void session.checkSignIn()} />
              <Button secondary title="Cancel sign-in" onPress={() => void session.cancelSignIn()} />
            </>}
            {error || session.error ? <Label>{error || session.error}</Label> : null}
            <Label muted>Your wallet signs a free identity request. Frogtown never asks for your seed phrase.</Label>
          </View>
          <LinearGradient
            colors={[colors.forest, colors.forestDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={[styles.heroOrbit, { borderColor: `${colors.leaf}21` }]} />
            <View style={[styles.heroOrbitInner, { borderColor: `${colors.mascotRed}54` }]} />
            <Text style={[styles.eyebrow, { color: colors.leaf }]}>$HERMIT COMMUNITY  /  WALLET-NATIVE</Text>
            <Text style={[styles.heroTitle, { color: colors.paper }]}>
              Good people.{'\n'}
              <Text style={[styles.heroTitleAccent, { color: colors.leaf }]}>Good signals.</Text>
            </Text>
            <Text style={[styles.heroDescription, { color: colors.paper }]}>
              A more human side of the ledger. Find your people, settle into a room, and make yourself at home.
            </Text>
            <View style={styles.heroArtworkFrame}>
            <View style={[styles.artworkGlow, { backgroundColor: `${colors.leaf}22` }]} />
              <Image
                source={require('../assets/images/icon.png')}
              style={[styles.heroArtwork, { borderColor: `${colors.leaf}c7` }]}
                contentFit="cover"
                accessibilityLabel="Frogtown hooded frog mascot"
              />
              <View style={styles.ledgerChip}>
              <View style={[styles.liveDot, { backgroundColor: colors.mascotRed }]} />
              <Text style={[styles.ledgerChipText, { color: colors.forest }]}>A new home for the community</Text>
              </View>
            </View>
            <View style={styles.heroFooter}>
              <Ionicons name="shield-checkmark-outline" size={15} color={colors.leaf} />
              <Text style={[styles.heroFooterText, { color: colors.paper }]}>Your wallet is your hello</Text>
            </View>
          </LinearGradient>

          <View style={styles.intro}>
            <Text style={[styles.sectionLabel, { color: colors.primary }]}>THE MOBILE EDITION</Text>
            <Text style={[styles.heading, { color: colors.foreground }]}>Frogtown, in your pocket.</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Your community, private messages, and group conversations — connected to the same Frogtown account.
            </Text>
          </View>

          <View style={styles.highlightList}>
            {highlights.map((item, index) => (
              <View
                key={item.title}
                style={[
                  styles.highlight,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    marginBottom: index === highlights.length - 1 ? 0 : 10,
                  },
                ]}
              >
                <View style={[styles.highlightIcon, { backgroundColor: colors.muted }]}>
                  <Ionicons name={item.icon} size={19} color={colors.primary} />
                </View>
                <View style={styles.highlightCopy}>
                  <Text style={[styles.highlightTitle, { color: colors.foreground }]}>{item.title}</Text>
                  <Text style={[styles.highlightDetail, { color: colors.mutedForeground }]}>{item.detail}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.statusNote, { borderColor: colors.border }]}>
            <View style={[styles.statusIcon, { backgroundColor: colors.secondary }]}>
              <Ionicons name="construct-outline" size={17} color={colors.secondaryForeground} />
            </View>
            <View style={styles.statusCopy}>
              <Text style={[styles.statusTitle, { color: colors.foreground }]}>One account. Your devices.</Text>
              <Text style={[styles.statusDetail, { color: colors.mutedForeground }]}>
                Connect your wallet in the secure browser, then restore your encrypted backup to access existing chats.
              </Text>
            </View>
          </View>

          <Text style={[styles.footer, { color: colors.mutedForeground }]}>
            FROGTOWN  ·  XRPL + LADYCHAIN  ·  $HERMIT
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export default function MobileHome() {
  return <SessionGate><FrogtownMobileWelcome /></SessionGate>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 28,
  },
  webInsets: { paddingTop: 67, paddingBottom: 34 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 2,
  },
  brandImage: { width: '100%', height: '100%' },
  brandName: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  brandMeta: { marginTop: 2, fontSize: 9, fontFamily: 'Inter_500Medium', letterSpacing: 1.8 },
  hero: {
    minHeight: 490,
    overflow: 'hidden',
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 25,
    paddingBottom: 18,
    justifyContent: 'space-between',
  },
  heroOrbit: {
    position: 'absolute',
    width: 290,
    height: 290,
    borderRadius: 145,
    borderWidth: 1,
    borderColor: 'transparent',
    top: 90,
    right: -115,
  },
  heroOrbitInner: {
    position: 'absolute',
    width: 214,
    height: 214,
    borderRadius: 107,
    borderWidth: 1,
    borderColor: 'transparent',
    top: 130,
    right: -76,
  },
  eyebrow: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.7,
  },
  heroTitle: {
    fontSize: 39,
    lineHeight: 40,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -2.2,
    marginTop: 18,
  },
  heroTitleAccent: {},
  heroDescription: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
    marginTop: 12,
    maxWidth: 310,
  },
  heroArtworkFrame: {
    minHeight: 205,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 9,
  },
  artworkGlow: {
    position: 'absolute',
    width: 188,
    height: 188,
    borderRadius: 94,
  },
  heroArtwork: {
    width: 176,
    height: 176,
    borderRadius: 88,
    borderWidth: 2,
  },
  ledgerChip: {
    position: 'absolute',
    left: 0,
    bottom: 6,
    maxWidth: 224,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(21, 61, 42, 0.1)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#e7463a' },
  ledgerChipText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', flexShrink: 1 },
  heroFooter: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 },
  heroFooterText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  intro: { marginTop: 28, marginBottom: 17 },
  sectionLabel: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.8 },
  heading: { fontSize: 25, lineHeight: 30, fontFamily: 'Inter_700Bold', letterSpacing: -0.9, marginTop: 8 },
  body: { fontSize: 13, lineHeight: 20, fontFamily: 'Inter_400Regular', marginTop: 8 },
  highlightList: { marginBottom: 16 },
  highlight: {
    minHeight: 72,
    borderRadius: 19,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  highlightIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightCopy: { flex: 1, gap: 3 },
  highlightTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  highlightDetail: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  statusNote: { borderTopWidth: 1, paddingTop: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  statusIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statusCopy: { flex: 1, paddingTop: 1, gap: 4 },
  statusTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  statusDetail: { fontSize: 11, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  footer: {
    textAlign: 'center',
    fontSize: 8,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 1.4,
    marginTop: 19,
  },
});
